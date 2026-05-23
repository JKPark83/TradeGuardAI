// Post-normalization validation for a single CSV row.
// Pure: no I/O, no DB lookups. Caller decides what to do with rejections.
//
// FR-004: the broker's reported PnL must agree with (exit - entry) * direction
// within tolerance (commissions/fees are often rolled into the broker number).

import type { NormalizedTradeRow } from './presets';

export type ValidationFailure = 'missing_field' | 'pnl_mismatch' | 'invalid_side' | 'invalid_date';

export type ValidationResult =
  | { ok: true }
  | { ok: false; reason: ValidationFailure; details: string };

/** Larger of 0.5% of |expected| or absolute $1. Brokers round commissions inline. */
function pnlTolerance(expected: number): number {
  return Math.max(Math.abs(expected) * 0.005, 1);
}

function parseNum(s: string): number {
  // Allow comma-grouped numbers ("1,234.56") and stray whitespace.
  return Number(s.replace(/,/g, '').trim());
}

function isValidIso(s: string): boolean {
  const d = new Date(s);
  return !Number.isNaN(d.getTime());
}

export function validateNormalizedRow(row: NormalizedTradeRow): ValidationResult {
  // ---- required scalars
  if (!row.symbol || !row.entry_at || !row.entry_price || !row.contracts) {
    return {
      ok: false,
      reason: 'missing_field',
      details: 'symbol, entry_at, entry_price, contracts are required',
    };
  }

  // ---- side
  if (row.side !== 'long' && row.side !== 'short') {
    return { ok: false, reason: 'invalid_side', details: `side="${row.side}" not in {long,short}` };
  }

  // ---- dates
  if (!isValidIso(row.entry_at)) {
    return { ok: false, reason: 'invalid_date', details: `entry_at="${row.entry_at}"` };
  }
  if (row.exit_at !== null && !isValidIso(row.exit_at)) {
    return { ok: false, reason: 'invalid_date', details: `exit_at="${row.exit_at}"` };
  }

  // ---- numeric parseability of entry_price/contracts
  const entryPrice = parseNum(row.entry_price);
  const contracts = parseNum(row.contracts);
  if (Number.isNaN(entryPrice) || Number.isNaN(contracts)) {
    return {
      ok: false,
      reason: 'missing_field',
      details: 'entry_price and contracts must be numeric',
    };
  }

  // ---- open positions skip pnl reconciliation
  if (row.exit_price === null || row.pnl === null) {
    return { ok: true };
  }

  const exitPrice = parseNum(row.exit_price);
  const pnl = parseNum(row.pnl);
  if (Number.isNaN(exitPrice) || Number.isNaN(pnl)) {
    return {
      ok: false,
      reason: 'missing_field',
      details: 'exit_price and pnl must be numeric when present',
    };
  }

  const direction = row.side === 'long' ? 1 : -1;
  const expected = (exitPrice - entryPrice) * direction * contracts;
  const tol = pnlTolerance(expected);
  if (Math.abs(pnl - expected) > tol) {
    return {
      ok: false,
      reason: 'pnl_mismatch',
      details: `reported pnl=${pnl}, expected≈${expected.toFixed(2)} (tol=${tol.toFixed(2)})`,
    };
  }

  return { ok: true };
}
