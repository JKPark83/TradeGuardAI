// Post-normalization validation for a single CSV row.
// Pure: no I/O, no DB lookups. Caller decides what to do with rejections.
//
// FR-004: the broker's reported PnL must agree with `(exit - entry) * direction`
// in *sign* (방향성). We deliberately do NOT compare magnitudes: brokers report
// PnL in USD (price points × contracts × per-symbol multiplier — $20/pt for NQ,
// $50/pt for ES, $2/pt for MNQ, etc.), and the multiplier is not visible in the
// CSV row. Comparing magnitude here would falsely reject every NQ/ES row.
//
// What we DO catch:
//   * Sign mismatch — broker says +$100 but `(exit-entry)*direction` is negative,
//     which is almost always a side/long-short mislabel or a swapped column.
//   * Zero-price-movement rows whose pnl is non-zero (data corruption).
//   * Trivially small / NaN values.

import type { NormalizedTradeRow } from './presets';

export type ValidationFailure = 'missing_field' | 'pnl_mismatch' | 'invalid_side' | 'invalid_date';

export type ValidationResult =
  | { ok: true }
  | { ok: false; reason: ValidationFailure; details: string };

function parseNum(s: string): number {
  // Allow comma-grouped numbers ("1,234.56") and stray whitespace.
  return Number(s.replace(/,/g, '').trim());
}

function isValidIso(s: string): boolean {
  const d = new Date(s);
  return !Number.isNaN(d.getTime());
}

/** True when `a` and `b` carry the same sign (both >0, both <0, or both ~0). */
function sameSign(a: number, b: number, eps = 0.005): boolean {
  if (Math.abs(a) < eps && Math.abs(b) < eps) return true;
  return Math.sign(a) === Math.sign(b);
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

  // Sign-only check (FR-004 "방향성"). See file header for rationale.
  const direction = row.side === 'long' ? 1 : -1;
  const pricePointDelta = (exitPrice - entryPrice) * direction;
  if (!sameSign(pricePointDelta, pnl)) {
    return {
      ok: false,
      reason: 'pnl_mismatch',
      details:
        `side=${row.side}, (exit-entry)*dir=${pricePointDelta.toFixed(4)} ` +
        `but reported pnl=${pnl} — signs disagree ` +
        `(가능 원인: side 라벨 뒤집힘 또는 가격·손익 컬럼 교차)`,
    };
  }

  return { ok: true };
}
