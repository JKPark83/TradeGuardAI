// Deterministic behavioral score functions.
//
// Contract: pure (no Date.now, no Math.random, no I/O). Same input → same output.
// All callers normalize DB strings into plain numbers before invoking.
// Outputs are integers clamped to [0, 100] — SC-002 requires byte-identical
// behavior scores across runs.
//
// Formulas are transcribed verbatim from research.md §R-07 — DO NOT tweak
// thresholds without updating R-07 and the golden fixtures together.

/** Clamp + integer-round into [0, 100]. */
function clamp100(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(100, Math.round(n)));
}

export interface StopDelayArgs {
  /** Minutes between entry_at and exit_at for this trade. */
  holdingMinutes: number;
  /** User's 30-day rolling average holding time (minutes). Must be > 0. */
  userAvgHoldingMinutes30d: number;
  /** Realized PnL for this trade. Wins (>=0) score 0 by definition. */
  pnl: number;
}

/**
 * Stop-Loss Delay Score (0..100).
 *
 * R-07.1:
 *   holding_ratio = holding_time / user_avg_holding_time_30d
 *   if pnl >= 0:                  score = 0
 *   elif holding_ratio <= 1.0:    score = 0
 *   elif holding_ratio <= 2.0:    score = 20
 *   elif holding_ratio <= 3.0:    score = 50
 *   else:                         score = min(100, 50 + (holding_ratio - 3) * 20)
 *
 * Degenerate baseline (user_avg <= 0) returns 0 — not enough history to judge.
 */
export function computeStopDelayScore(args: StopDelayArgs): number {
  const { holdingMinutes, userAvgHoldingMinutes30d, pnl } = args;
  if (pnl >= 0) return 0;
  if (userAvgHoldingMinutes30d <= 0) return 0;
  const ratio = holdingMinutes / userAvgHoldingMinutes30d;
  if (ratio <= 1.0) return 0;
  if (ratio <= 2.0) return 20;
  if (ratio <= 3.0) return 50;
  return clamp100(50 + (ratio - 3.0) * 20);
}

export interface RevengeArgs {
  /** Consecutive losing trades before this one (>=0). */
  prevConsecutiveLossCount: number;
  /** Minutes between previous loss exit_at and this entry_at. null = no prior loss. */
  gapMinutesSincePrevLoss: number | null;
}

/**
 * Revenge Trade Score (0..100).
 *
 * R-07.2:
 *   if prev_consecutive_loss_count == 0:                      score = 0
 *   elif gap < 10 and prev_consecutive_loss_count >= 2:       score = 80
 *   elif gap < 10 and prev_consecutive_loss_count == 1:       score = 50
 *   elif gap < 30:                                            score = 30
 *   else:                                                     score = 0
 */
export function computeRevengeScore(args: RevengeArgs): number {
  const { prevConsecutiveLossCount, gapMinutesSincePrevLoss } = args;
  if (prevConsecutiveLossCount <= 0) return 0;
  if (gapMinutesSincePrevLoss === null) return 0;
  if (gapMinutesSincePrevLoss < 10 && prevConsecutiveLossCount >= 2) return 80;
  if (gapMinutesSincePrevLoss < 10 && prevConsecutiveLossCount === 1) return 50;
  if (gapMinutesSincePrevLoss < 30) return 30;
  return 0;
}

export interface OverconfidenceArgs {
  /** PnL of immediately previous trade. null = no prior trade. */
  prevPnl: number | null;
  /** Contracts on this trade. */
  contracts: number;
  /** User's 30-day median contracts. Must be > 0 to derive ratio. */
  userMedianContracts30d: number;
  /** Current win streak length (>=0). */
  winStreak: number;
}

/**
 * Overconfidence Score (0..100).
 *
 * R-07.3:
 *   size_ratio = this.contracts / user_median_contracts_30d
 *   if prev_trade.pnl > 0 and size_ratio >= 2.0:        score = 80
 *   elif prev_trade.pnl > 0 and size_ratio >= 1.5:      score = 50
 *   elif win_streak >= 3 and size_ratio >= 1.5:         score = 60
 *   else:                                               score = 0
 */
export function computeOverconfidenceScore(args: OverconfidenceArgs): number {
  const { prevPnl, contracts, userMedianContracts30d, winStreak } = args;
  if (userMedianContracts30d <= 0) return 0;
  const sizeRatio = contracts / userMedianContracts30d;
  if (prevPnl !== null && prevPnl > 0 && sizeRatio >= 2.0) return 80;
  if (prevPnl !== null && prevPnl > 0 && sizeRatio >= 1.5) return 50;
  if (winStreak >= 3 && sizeRatio >= 1.5) return 60;
  return 0;
}
