// Similar-past-trade lookup — research.md §R-07.5 row "과거 유사 컨텍스트 본인 패율".
//
// Computes cosine similarity between a candidate trade context and each
// historical trade over a 4-dimensional feature vector:
//
//   1. symbol_match    : 1 if same symbol, else 0
//   2. side_match      : 1 if same side, else 0
//   3. vix_proximity   : max(0, 1 - |vix_diff| / VIX_SCALE)   (smooth)
//   4. event_match     : 1 if same event_type (case-insensitive), else 0
//
// Cosine similarity is computed over the binary/normalized vectors. Each
// dimension is bounded to [0, 1], so dot product ∈ [0, 4] and ||vec|| ≤ 2,
// giving similarity ∈ [0, 1]. Pure function — same inputs → same output.

import type { Trade, TradeSide, UUID } from '@/types/db';

export interface SimilarCandidate {
  symbol: string;
  side: TradeSide;
  currentVix: number | null;
  currentEvent: string | null;
}

export interface SimilarTradeSnapshot {
  vix: number | null;
  event_type: string | null;
}

export interface SimilarTradeMatch {
  tradeId: UUID;
  similarity: number;
  pnl: number | null;
}

export interface FindSimilarTradesArgs {
  history: Trade[];
  candidate: SimilarCandidate;
  topK: number;
  snapshotsByTradeId: Map<UUID, SimilarTradeSnapshot>;
}

/** VIX spread normalization — diffs ≥ this saturate vix_proximity at 0. */
const VIX_SCALE = 30;

function symbolFeature(a: string, b: string): number {
  return a === b ? 1 : 0;
}

function sideFeature(a: TradeSide, b: TradeSide): number {
  return a === b ? 1 : 0;
}

function vixProximityFeature(a: number | null, b: number | null): number {
  if (a === null || b === null || !Number.isFinite(a) || !Number.isFinite(b)) return 0;
  const diff = Math.abs(a - b);
  return Math.max(0, 1 - diff / VIX_SCALE);
}

function eventMatchFeature(a: string | null, b: string | null): number {
  if (a === null || b === null) return 0;
  return a.toLowerCase() === b.toLowerCase() ? 1 : 0;
}

function dot(a: ReadonlyArray<number>, b: ReadonlyArray<number>): number {
  let s = 0;
  for (let i = 0; i < a.length; i += 1) s += a[i] * b[i];
  return s;
}

function norm(v: ReadonlyArray<number>): number {
  let s = 0;
  for (const x of v) s += x * x;
  return Math.sqrt(s);
}

function cosine(a: ReadonlyArray<number>, b: ReadonlyArray<number>): number {
  const na = norm(a);
  const nb = norm(b);
  if (na === 0 || nb === 0) return 0;
  return dot(a, b) / (na * nb);
}

/**
 * Rank past trades by cosine similarity to `candidate`. Returns up to `topK`
 * matches, sorted by similarity desc. Trades with no snapshot are still
 * considered — they just contribute 0 to the vix/event dimensions.
 */
export function findSimilarTrades(args: FindSimilarTradesArgs): SimilarTradeMatch[] {
  const { history, candidate, topK, snapshotsByTradeId } = args;
  if (topK <= 0 || history.length === 0) return [];

  // Candidate vector: full-weight self-match on its own attributes.
  const candVec = [
    1, // symbol "same as self"
    1, // side  "same as self"
    candidate.currentVix !== null ? 1 : 0, // proximity to self is 1 when defined
    candidate.currentEvent !== null ? 1 : 0,
  ];

  const matches: SimilarTradeMatch[] = [];
  for (const t of history) {
    const snap = snapshotsByTradeId.get(t.id);
    const tradeVec = [
      symbolFeature(t.symbol, candidate.symbol),
      sideFeature(t.side, candidate.side),
      vixProximityFeature(snap?.vix ?? null, candidate.currentVix),
      eventMatchFeature(snap?.event_type ?? null, candidate.currentEvent),
    ];
    const similarity = cosine(candVec, tradeVec);
    if (similarity <= 0) continue;
    matches.push({
      tradeId: t.id,
      similarity,
      pnl: t.pnl === null ? null : Number(t.pnl),
    });
  }

  matches.sort((a, b) => b.similarity - a.similarity);
  return matches.slice(0, topK);
}

/**
 * Convenience: among a set of matches, compute the loss rate (share with
 * pnl < 0). Used by `computeSimilarHistoryLossRateSignal` to drive the
 * weighted risk score.
 *
 * Returns null when there is insufficient data (no matches with pnl).
 */
export function similarLossRate(matches: SimilarTradeMatch[]): number | null {
  const closed = matches.filter((m) => m.pnl !== null);
  if (closed.length === 0) return null;
  const losses = closed.filter((m) => (m.pnl as number) < 0).length;
  return losses / closed.length;
}
