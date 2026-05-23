/**
 * Unit tests for lib/llm/anonymize.ts.
 *
 * Spec contract:
 *   - Deterministic: same (value, secret) → same token, forever (FR-018).
 *   - Secret-bound: different secrets → different tokens (no cross-user leak).
 *   - Field-level: anonymizeTrade strips PII fields and tokenizes IDs, while
 *     preserving analysis-relevant numeric/temporal fields verbatim.
 *   - Round-trip: same trade + same secret → identical token set across calls.
 */

import { describe, expect, it } from 'vitest';
import { anonymizeTrade, anonymizeValue } from '@/lib/llm/anonymize';
import type { Trade } from '@/types/db';

const SECRET_A = 'test-secret-alpha-0123456789';
const SECRET_B = 'test-secret-bravo-9876543210';

function makeTrade(overrides: Partial<Trade> = {}): Trade {
  return {
    id: '11111111-1111-1111-1111-111111111111',
    owner_id: '22222222-2222-2222-2222-222222222222',
    session_id: '33333333-3333-3333-3333-333333333333',
    symbol: 'NQ',
    side: 'long',
    entry_price: '20000.25',
    exit_price: '20050.50',
    entry_at: '2026-05-23T13:30:00Z',
    exit_at: '2026-05-23T14:00:00Z',
    pnl: '50.25',
    contracts: '2',
    source_csv_id: '44444444-4444-4444-4444-444444444444',
    source_row: 7,
    created_at: '2026-05-23T13:30:00Z',
    ...overrides,
  };
}

describe('anonymizeValue', () => {
  it('is deterministic across 100 calls with the same (value, secret)', () => {
    const expected = anonymizeValue('hello', SECRET_A);
    for (let i = 0; i < 100; i += 1) {
      expect(anonymizeValue('hello', SECRET_A)).toBe(expected);
    }
  });

  it('produces different outputs for different secrets', () => {
    const tokenA = anonymizeValue('hello', SECRET_A);
    const tokenB = anonymizeValue('hello', SECRET_B);
    expect(tokenA).not.toBe(tokenB);
  });

  it('produces different outputs for different values with the same secret', () => {
    const t1 = anonymizeValue('value-1', SECRET_A);
    const t2 = anonymizeValue('value-2', SECRET_A);
    expect(t1).not.toBe(t2);
  });

  it('returns a 12-char hex token', () => {
    const token = anonymizeValue('account-12345', SECRET_A);
    expect(token).toMatch(/^[0-9a-f]{12}$/);
  });

  it('throws when userSecret is empty', () => {
    expect(() => anonymizeValue('hello', '')).toThrow(/userSecret is required/);
  });
});

describe('anonymizeTrade', () => {
  it('tokenizes id and session_id with T_ / S_ prefixes', () => {
    const trade = makeTrade();
    const anon = anonymizeTrade(trade, SECRET_A);
    expect(anon.id).toMatch(/^T_[0-9a-f]{12}$/);
    expect(anon.session_id).toMatch(/^S_[0-9a-f]{12}$/);
  });

  it('preserves analysis-relevant fields verbatim', () => {
    const trade = makeTrade();
    const anon = anonymizeTrade(trade, SECRET_A);
    expect(anon.symbol).toBe(trade.symbol);
    expect(anon.side).toBe(trade.side);
    expect(anon.entry_price).toBe(trade.entry_price);
    expect(anon.exit_price).toBe(trade.exit_price);
    expect(anon.entry_at).toBe(trade.entry_at);
    expect(anon.exit_at).toBe(trade.exit_at);
    expect(anon.contracts).toBe(trade.contracts);
    expect(anon.pnl).toBe(trade.pnl);
  });

  it('omits PII-bearing fields (owner_id, source_csv_id, source_row, created_at)', () => {
    const trade = makeTrade();
    const anon = anonymizeTrade(trade, SECRET_A) as unknown as Record<string, unknown>;
    expect(anon.owner_id).toBeUndefined();
    expect(anon.source_csv_id).toBeUndefined();
    expect(anon.source_row).toBeUndefined();
    expect(anon.created_at).toBeUndefined();
  });

  it('returns null session_id when input session_id is null', () => {
    const trade = makeTrade({ session_id: null });
    const anon = anonymizeTrade(trade, SECRET_A);
    expect(anon.session_id).toBeNull();
  });

  it('round-trip: same trade + same secret → identical tokens across multiple calls', () => {
    const trade = makeTrade();
    const a = anonymizeTrade(trade, SECRET_A);
    const b = anonymizeTrade(trade, SECRET_A);
    const c = anonymizeTrade(trade, SECRET_A);
    expect(b).toEqual(a);
    expect(c).toEqual(a);
  });

  it('different secrets produce different tokens for the same trade', () => {
    const trade = makeTrade();
    const a = anonymizeTrade(trade, SECRET_A);
    const b = anonymizeTrade(trade, SECRET_B);
    expect(a.id).not.toBe(b.id);
    expect(a.session_id).not.toBe(b.session_id);
    // But preserved fields stay equal.
    expect(a.symbol).toBe(b.symbol);
    expect(a.entry_price).toBe(b.entry_price);
  });
});
