/**
 * Behavioral profile aggregates — per-user roll-ups.
 *
 * Validates the BehavioralProfile shape (types/db.ts → BehavioralProfile)
 * computed from a list of normalized trades:
 *   - maxLossStreak: longest consecutive losing trade run
 *   - totalTrades: count of closed trades
 *   - nightTradingRatio: fraction of trades entered between 22:00–06:00 user-local
 *
 * Empty arrays → aggregates are `null` (NOT 0/NaN) per data-model.md
 * "NULL until first recompute job runs" semantics.
 */

import { describe, it, expect } from 'vitest';

import { computeBehavioralProfile as computeBehavioralAggregates } from '@/lib/scoring/behavioral-aggregates';
import type { Trade } from '@/types/db';

// Minimal trade-builder — fills in only the fields the aggregator reads.
function trade(overrides: Partial<Trade> = {}): Trade {
  return {
    id: 'trade-' + Math.random().toString(36).slice(2, 10),
    owner_id: 'user-1',
    session_id: null,
    symbol: 'NQ',
    side: 'long',
    entry_price: '100',
    exit_price: '110',
    entry_at: '2026-05-20T13:00:00Z',
    exit_at: '2026-05-20T13:30:00Z',
    pnl: '10',
    contracts: '1',
    source_csv_id: null,
    source_row: null,
    created_at: '2026-05-20T13:30:00Z',
    ...overrides,
  };
}

describe('computeBehavioralAggregates — 10-trade fixture', () => {
  // Pattern: W L L L W W L L L L  → max_loss_streak = 4, total = 10
  // Entries at: 14:00, 15:00, 16:00, 22:30, 23:30, 02:30, 03:30, 09:00, 10:00, 11:00 UTC
  // Night trades (22:00–06:00): rows 4, 5, 6, 7 → 4 / 10 = 0.4
  const trades: Trade[] = [
    trade({ pnl: '10', entry_at: '2026-05-20T14:00:00Z' }),
    trade({ pnl: '-5', entry_at: '2026-05-20T15:00:00Z' }),
    trade({ pnl: '-8', entry_at: '2026-05-20T16:00:00Z' }),
    trade({ pnl: '-3', entry_at: '2026-05-20T22:30:00Z' }),
    trade({ pnl: '15', entry_at: '2026-05-20T23:30:00Z' }),
    trade({ pnl: '20', entry_at: '2026-05-21T02:30:00Z' }),
    trade({ pnl: '-2', entry_at: '2026-05-21T03:30:00Z' }),
    trade({ pnl: '-4', entry_at: '2026-05-21T09:00:00Z' }),
    trade({ pnl: '-6', entry_at: '2026-05-21T10:00:00Z' }),
    trade({ pnl: '-1', entry_at: '2026-05-21T11:00:00Z' }),
  ];

  it('totalTrades counts all closed trades', () => {
    const profile = computeBehavioralAggregates(trades, []);
    expect(profile.totalTrades).toBe(10);
  });

  it('maxLossStreak is the longest consecutive losing run', () => {
    const profile = computeBehavioralAggregates(trades, []);
    // L L L L at indices 6,7,8,9 → streak 4
    expect(profile.maxLossStreak).toBe(4);
  });

  it('nightTradingRatio is fraction of trades entered 22:00–06:00 UTC', () => {
    const profile = computeBehavioralAggregates(trades, []);
    // 4 night entries / 10 total = 0.4
    expect(profile.nightTradingRatio).toBeCloseTo(0.4, 5);
  });

  it('determinism: same trades yield identical aggregates 100 times', () => {
    const first = computeBehavioralAggregates(trades, []);
    for (let i = 0; i < 100; i += 1) {
      const next = computeBehavioralAggregates(trades, []);
      expect(next).toEqual(first);
    }
  });
});

describe('computeBehavioralAggregates — empty input', () => {
  it('returns null aggregates (not 0/NaN) when trades array is empty', () => {
    const profile = computeBehavioralAggregates([], []);
    // totalTrades is the one safe "count" field — must be 0.
    expect(profile.totalTrades).toBe(0);
    // `maxLossStreak` is a count (INT NOT NULL in the DB) — always 0 on empty.
    expect(profile.maxLossStreak).toBe(0);
    // Distributional aggregates remain null per data-model.md.
    expect(profile.nightTradingRatio).toBeNull();
    expect(profile.avgStopDelayScore).toBeNull();
    expect(profile.avgRevengeTradeGapMinutes).toBeNull();
    expect(profile.overconfidenceScore).toBeNull();
  });

  it('NaN never leaks into aggregate outputs', () => {
    const profile = computeBehavioralAggregates([], []);
    for (const v of Object.values(profile)) {
      if (typeof v === 'number') {
        expect(Number.isNaN(v)).toBe(false);
      }
    }
  });
});

describe('computeBehavioralAggregates — single-trade edge cases', () => {
  it('single winning trade: maxLossStreak = 0', () => {
    const profile = computeBehavioralAggregates([trade({ pnl: '10' })], []);
    expect(profile.totalTrades).toBe(1);
    expect(profile.maxLossStreak).toBe(0);
  });

  it('single losing trade: maxLossStreak = 1', () => {
    const profile = computeBehavioralAggregates([trade({ pnl: '-10' })], []);
    expect(profile.totalTrades).toBe(1);
    expect(profile.maxLossStreak).toBe(1);
  });
});
