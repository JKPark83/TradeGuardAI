/**
 * Similar-trade cosine ranking — pure-function unit tests.
 */

import { describe, expect, it } from 'vitest';

import { findSimilarTrades, similarLossRate } from '@/lib/scoring/similar';
import type { SimilarTradeSnapshot } from '@/lib/scoring/similar';
import type { Trade, UUID } from '@/types/db';

function makeTrade(overrides: Partial<Trade>): Trade {
  return {
    id: overrides.id ?? '00000000-0000-0000-0000-000000000000',
    owner_id: '00000000-0000-0000-0000-000000000aaa',
    session_id: null,
    symbol: 'NQ',
    side: 'long',
    entry_price: '20000',
    exit_price: '19950',
    entry_at: '2026-05-01T13:30:00Z',
    exit_at: '2026-05-01T14:00:00Z',
    pnl: '-50.00',
    contracts: '2',
    source_csv_id: null,
    source_row: null,
    created_at: '2026-05-01T13:30:00Z',
    ...overrides,
  };
}

function snap(vix: number | null, event_type: string | null): SimilarTradeSnapshot {
  return { vix, event_type };
}

describe('findSimilarTrades — ranking', () => {
  it('exact (symbol + side) match ranks higher than partial', () => {
    const history: Trade[] = [
      makeTrade({ id: 'a' as UUID, symbol: 'NQ', side: 'long' }),
      makeTrade({ id: 'b' as UUID, symbol: 'ES', side: 'long' }),
      makeTrade({ id: 'c' as UUID, symbol: 'NQ', side: 'short' }),
      makeTrade({ id: 'd' as UUID, symbol: 'ES', side: 'short' }),
    ];
    const snapshots = new Map<UUID, SimilarTradeSnapshot>();
    const r = findSimilarTrades({
      history,
      candidate: { symbol: 'NQ', side: 'long', currentVix: null, currentEvent: null },
      topK: 4,
      snapshotsByTradeId: snapshots,
    });
    expect(r[0].tradeId).toBe('a');
    expect(r[0].similarity).toBeGreaterThan(r[1].similarity);
  });

  it('topK truncates the result list', () => {
    const history: Trade[] = Array.from({ length: 10 }, (_, i) =>
      makeTrade({ id: `t${i}` as UUID, symbol: i % 2 === 0 ? 'NQ' : 'ES', side: 'long' }),
    );
    const r = findSimilarTrades({
      history,
      candidate: { symbol: 'NQ', side: 'long', currentVix: null, currentEvent: null },
      topK: 3,
      snapshotsByTradeId: new Map(),
    });
    expect(r.length).toBeLessThanOrEqual(3);
  });

  it('returns matches sorted by similarity desc', () => {
    const history: Trade[] = [
      makeTrade({ id: 'a' as UUID, symbol: 'NQ', side: 'long' }),
      makeTrade({ id: 'b' as UUID, symbol: 'NQ', side: 'short' }),
      makeTrade({ id: 'c' as UUID, symbol: 'NQ', side: 'long' }),
    ];
    const r = findSimilarTrades({
      history,
      candidate: { symbol: 'NQ', side: 'long', currentVix: null, currentEvent: null },
      topK: 10,
      snapshotsByTradeId: new Map(),
    });
    for (let i = 1; i < r.length; i += 1) {
      expect(r[i - 1].similarity).toBeGreaterThanOrEqual(r[i].similarity);
    }
  });
});

describe('findSimilarTrades — vix distance', () => {
  it('closer VIX → higher similarity', () => {
    const history: Trade[] = [
      makeTrade({ id: 'near' as UUID, symbol: 'NQ', side: 'long' }),
      makeTrade({ id: 'far' as UUID, symbol: 'NQ', side: 'long' }),
    ];
    const snapshots = new Map<UUID, SimilarTradeSnapshot>([
      ['near' as UUID, snap(20, null)],
      ['far' as UUID, snap(5, null)],
    ]);
    const r = findSimilarTrades({
      history,
      candidate: { symbol: 'NQ', side: 'long', currentVix: 20, currentEvent: null },
      topK: 2,
      snapshotsByTradeId: snapshots,
    });
    const nearMatch = r.find((m) => m.tradeId === 'near');
    const farMatch = r.find((m) => m.tradeId === 'far');
    expect(nearMatch).toBeDefined();
    expect(farMatch).toBeDefined();
    expect(nearMatch!.similarity).toBeGreaterThan(farMatch!.similarity);
  });
});

describe('findSimilarTrades — event match bump', () => {
  it('same event_type bumps similarity above the no-event baseline', () => {
    const history: Trade[] = [
      makeTrade({ id: 'cpi' as UUID, symbol: 'NQ', side: 'long' }),
      makeTrade({ id: 'plain' as UUID, symbol: 'NQ', side: 'long' }),
    ];
    const snapshots = new Map<UUID, SimilarTradeSnapshot>([
      ['cpi' as UUID, snap(20, 'cpi')],
      ['plain' as UUID, snap(20, null)],
    ]);
    const r = findSimilarTrades({
      history,
      candidate: { symbol: 'NQ', side: 'long', currentVix: 20, currentEvent: 'cpi' },
      topK: 2,
      snapshotsByTradeId: snapshots,
    });
    const cpiMatch = r.find((m) => m.tradeId === 'cpi');
    const plainMatch = r.find((m) => m.tradeId === 'plain');
    expect(cpiMatch).toBeDefined();
    expect(plainMatch).toBeDefined();
    expect(cpiMatch!.similarity).toBeGreaterThan(plainMatch!.similarity);
  });
});

describe('findSimilarTrades — edge cases', () => {
  it('empty history → empty result', () => {
    const r = findSimilarTrades({
      history: [],
      candidate: { symbol: 'NQ', side: 'long', currentVix: null, currentEvent: null },
      topK: 5,
      snapshotsByTradeId: new Map(),
    });
    expect(r).toEqual([]);
  });

  it('topK = 0 → empty result', () => {
    const r = findSimilarTrades({
      history: [makeTrade({ id: 'a' as UUID })],
      candidate: { symbol: 'NQ', side: 'long', currentVix: null, currentEvent: null },
      topK: 0,
      snapshotsByTradeId: new Map(),
    });
    expect(r).toEqual([]);
  });
});

describe('similarLossRate', () => {
  it('null when no closed trades', () => {
    expect(similarLossRate([])).toBeNull();
  });

  it('returns the loss share', () => {
    expect(
      similarLossRate([
        { tradeId: 'a', similarity: 1, pnl: -10 },
        { tradeId: 'b', similarity: 0.9, pnl: -5 },
        { tradeId: 'c', similarity: 0.8, pnl: 20 },
        { tradeId: 'd', similarity: 0.7, pnl: -1 },
      ]),
    ).toBeCloseTo(0.75, 10);
  });
});
