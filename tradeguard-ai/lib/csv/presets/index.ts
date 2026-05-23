// Broker CSV preset registry. System presets are hardcoded in sibling files;
// user-defined mappings live in `broker_mapping_presets` (see data-model.md).
//
// All logic here is pure: header detection and row normalization only — no DB.

import type { PnlSignConvention, TradeSide } from '@/types/db';
import { ebestPreset } from './ebest';
import { ninjatraderPreset } from './ninjatrader';
import { tradingviewPreset } from './tradingview';

/**
 * Canonical normalized fields used by the CSV → DB pipeline.
 * Maps to `Trade` minus owner/id/source columns (those are filled by the writer).
 */
export interface NormalizedTradeRow {
  symbol: string;
  side: TradeSide;
  entry_at: string;
  exit_at: string | null;
  entry_price: string;
  exit_price: string | null;
  pnl: string | null;
  contracts: string;
  source_row: number;
}

/** Logical fields exposed by `column_mapping`. */
export type PresetField =
  | 'symbol'
  | 'side'
  | 'entry_at'
  | 'exit_at'
  | 'entry_price'
  | 'exit_price'
  | 'pnl'
  | 'contracts';

export interface BrokerPreset {
  name: string;
  /** All of these headers MUST exist in the CSV to auto-detect this preset. */
  headerSignature: string[];
  /** Logical field -> raw CSV column name. */
  columnMapping: Record<PresetField, string>;
  /** strftime-like pattern; informational — actual parsing uses `Date` heuristics. */
  timeFormat: string;
  pnlSignConvention: PnlSignConvention;
  /** Raw broker side strings to normalized 'long'/'short'. */
  sideValueMap: Record<string, TradeSide>;
}

export interface PresetMatch {
  preset: BrokerPreset;
  confidence: 'exact' | 'fuzzy';
}

export const SYSTEM_PRESETS: BrokerPreset[] = [ebestPreset, ninjatraderPreset, tradingviewPreset];

/**
 * Detect a broker preset from CSV headers. Matches by subset:
 * every header in `preset.headerSignature` must appear in the provided `headers`.
 * Returns the first matching preset (insertion order of SYSTEM_PRESETS).
 *
 * Confidence is `'exact'` when the header sets match 1:1 (same length, same members),
 * `'fuzzy'` when the signature is a strict subset of `headers`.
 */
export function detectPreset(headers: string[]): PresetMatch | null {
  const headerSet = new Set(headers);
  for (const preset of SYSTEM_PRESETS) {
    const allPresent = preset.headerSignature.every((h) => headerSet.has(h));
    if (!allPresent) continue;
    const exact =
      preset.headerSignature.length === headers.length &&
      preset.headerSignature.every((h) => headerSet.has(h));
    return { preset, confidence: exact ? 'exact' : 'fuzzy' };
  }
  return null;
}

function nonEmpty(v: string | undefined): string | null {
  if (v === undefined) return null;
  const t = v.trim();
  return t === '' ? null : t;
}

function requireField(row: Record<string, string>, col: string, field: PresetField): string {
  const raw = row[col];
  const v = nonEmpty(raw);
  if (v === null) {
    throw new Error(`applyPreset: required field "${field}" (column "${col}") is empty`);
  }
  return v;
}

/**
 * Apply a preset's column mapping to raw CSV rows. Returns `NormalizedTradeRow[]`
 * with stringified numerics (matching DB NUMERIC-as-string convention).
 *
 * - Sides are normalized via `sideValueMap`. Unknown sides throw.
 * - Optional fields (`exit_at`, `exit_price`, `pnl`) become `null` when blank.
 * - `source_row` is 1-based (header counts as row 0).
 */
/**
 * Compute PnL from price/side/contracts. Used when `pnlSignConvention === 'computed'`
 * (the broker exports a magnitude-only PnL or omits PnL entirely — we derive sign).
 *
 * Returns the canonical signed PnL as a numeric string, or null if any input is missing.
 */
function computePnl(
  side: TradeSide,
  entryPriceStr: string,
  exitPriceStr: string | null,
  contractsStr: string,
): string | null {
  if (exitPriceStr === null) return null;
  const entry = Number(entryPriceStr);
  const exit = Number(exitPriceStr);
  const qty = Number(contractsStr);
  if (!Number.isFinite(entry) || !Number.isFinite(exit) || !Number.isFinite(qty)) return null;
  const dir = side === 'long' ? 1 : -1;
  return ((exit - entry) * dir * qty).toFixed(2);
}

export function applyPreset(
  rawRows: Record<string, string>[],
  preset: BrokerPreset,
): NormalizedTradeRow[] {
  const m = preset.columnMapping;
  return rawRows.map((row, idx) => {
    const rawSide = requireField(row, m.side, 'side');
    const side = preset.sideValueMap[rawSide];
    if (side !== 'long' && side !== 'short') {
      throw new Error(`applyPreset: unknown side value "${rawSide}" at row ${idx + 1}`);
    }
    const symbol = requireField(row, m.symbol, 'symbol');
    const entryAt = requireField(row, m.entry_at, 'entry_at');
    const exitAt = nonEmpty(row[m.exit_at]);
    const entryPrice = requireField(row, m.entry_price, 'entry_price');
    const exitPrice = nonEmpty(row[m.exit_price]);
    const contracts = requireField(row, m.contracts, 'contracts');

    // PnL: with `broker_native` we trust the broker's signed value as-is.
    // With `computed`, we recompute from prices/side/contracts to guarantee
    // canonical sign (negative = loss) regardless of broker convention.
    const pnl =
      preset.pnlSignConvention === 'computed'
        ? computePnl(side, entryPrice, exitPrice, contracts)
        : nonEmpty(row[m.pnl]);

    return {
      symbol,
      side,
      entry_at: entryAt,
      exit_at: exitAt,
      entry_price: entryPrice,
      exit_price: exitPrice,
      pnl,
      contracts,
      source_row: idx + 1,
    };
  });
}
