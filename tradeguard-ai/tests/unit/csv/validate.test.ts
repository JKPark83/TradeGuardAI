/**
 * Normalized row validator — schema + pnl-sign + sanity checks.
 *
 * Validates contracts/trades-api.md (POST /api/trades/upload):
 *   - Missing required field → rejected with reason 'missing_field'
 *   - PnL sign mismatch (e.g., long entry=100, exit=110, but pnl=-10) → 'pnl_mismatch'
 *   - Tolerance: ~$0.50 drift on pnl passes
 *   - Open positions (exit_price/pnl null) skip pnl check
 *   - Invalid side value → 'invalid_side'
 */

import { describe, it, expect } from 'vitest';

import { validateNormalizedRow } from '@/lib/csv/validate';
import type { NormalizedTradeRow } from '@/lib/csv/presets/index';

function row(overrides: Partial<NormalizedTradeRow> = {}): NormalizedTradeRow {
  return {
    symbol: 'NQ',
    side: 'long',
    entry_at: '2026-05-20T13:00:00Z',
    exit_at: '2026-05-20T13:42:00Z',
    entry_price: '100',
    exit_price: '110',
    pnl: '10',
    contracts: '1',
    source_row: 1,
    ...overrides,
  };
}

describe('validateNormalizedRow — happy path', () => {
  it('accepts a fully populated long winning trade', () => {
    const result = validateNormalizedRow(row());
    expect(result.ok).toBe(true);
  });

  it('accepts a fully populated short trade with matching pnl', () => {
    const result = validateNormalizedRow(
      row({ side: 'short', entry_price: '110', exit_price: '100', pnl: '10' }),
    );
    expect(result.ok).toBe(true);
  });

  it('accepts an open position (exit_price null, pnl null) and skips pnl check', () => {
    const result = validateNormalizedRow(row({ exit_at: null, exit_price: null, pnl: null }));
    expect(result.ok).toBe(true);
  });
});

describe('validateNormalizedRow — missing required fields', () => {
  it.each([
    { field: 'symbol' as const, patch: { symbol: '' } },
    { field: 'entry_at' as const, patch: { entry_at: '' } },
    { field: 'entry_price' as const, patch: { entry_price: '' } },
    { field: 'contracts' as const, patch: { contracts: '' } },
  ])('rejects when $field is empty', ({ patch }) => {
    const result = validateNormalizedRow(row(patch as Partial<NormalizedTradeRow>));
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe('missing_field');
    }
  });
});

describe('validateNormalizedRow — pnl sign check (FR-004 방향성)', () => {
  it('rejects long trade where exit > entry but pnl is negative', () => {
    const result = validateNormalizedRow(
      row({ side: 'long', entry_price: '100', exit_price: '110', pnl: '-10' }),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe('pnl_mismatch');
    }
  });

  it('rejects short trade where exit < entry but pnl is negative', () => {
    const result = validateNormalizedRow(
      row({ side: 'short', entry_price: '110', exit_price: '100', pnl: '-10' }),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe('pnl_mismatch');
    }
  });

  it('accepts long trade where pnl magnitude reflects per-symbol multiplier (NQ ×$20)', () => {
    // NQ: 1 point = $20 per contract. Price up 1pt × 2 contracts → pnl = +$40,
    // not +2. Sign-only check must let this through; magnitude is unknowable
    // without a per-symbol multiplier table in the validator (FR-004 본문 참조).
    const result = validateNormalizedRow(
      row({
        side: 'long',
        entry_price: '17950.25',
        exit_price: '17951.25',
        pnl: '40',
        contracts: '2',
      }),
    );
    expect(result.ok).toBe(true);
  });

  it('accepts short trade where pnl magnitude reflects per-symbol multiplier (NQ ×$20)', () => {
    // Mirror of the long case: price down 1pt on a short → +$40 per 2 contracts.
    const result = validateNormalizedRow(
      row({
        side: 'short',
        entry_price: '17951.25',
        exit_price: '17950.25',
        pnl: '40',
        contracts: '2',
      }),
    );
    expect(result.ok).toBe(true);
  });

  it('accepts tiny pnl drift (broker rounding / commissions)', () => {
    // (110 - 100) * 1 = 10 → sign +. CSV reports 9.50 — same sign, passes.
    const result = validateNormalizedRow(
      row({ side: 'long', entry_price: '100', exit_price: '110', pnl: '9.50' }),
    );
    expect(result.ok).toBe(true);
  });

  it('rejects pnl with clearly wrong sign (long winner reported as loss)', () => {
    // Computed direction is +; CSV reports -100. Magnitude beyond anything
    // commissions can explain, AND the sign is wrong — fails sign check.
    const result = validateNormalizedRow(
      row({ side: 'long', entry_price: '100', exit_price: '110', pnl: '-100' }),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe('pnl_mismatch');
    }
  });
});

describe('validateNormalizedRow — invalid side', () => {
  it('rejects rows whose side is not "long" or "short"', () => {
    const bad = { ...row(), side: 'foobar' } as unknown as NormalizedTradeRow;
    const result = validateNormalizedRow(bad);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe('invalid_side');
    }
  });
});
