// Real-time entry-risk score — research.md §R-07.5 (5-signal weighted formula).
//
// Pure, deterministic. Integer-clamped to [0, 100]. SC-002 requires byte-
// identical results for the same input; SC-008 requires the Tilt-Red floor.
//
// Default weights (sum = 1.00):
//
//   recentPnlStreak        : 0.20
//   marketContext          : 0.15
//   similarHistoryLossRate : 0.25
//   tilt                   : 0.20
//   propFirmRoom           : 0.20
//
// Absent-signal handling (per contracts/risk-api.md):
//   - `tilt === null`         → no tilt check-in for the active session
//   - `propFirmRoom === null` → no active prop-firm profile
//   The corresponding weight is redistributed PROPORTIONALLY across the
//   remaining signals. The remaining weights are renormalized so the sum
//   stays exactly 1.0 (within float tolerance).
//
// Tilt-Red floor (FR-025 / SC-008):
//   If `tilt === 100` (Red), the final score is clamped to be at least 70.

import type { RiskAssessmentSignals, RiskAssessmentWeights } from '@/types/db';

export type RiskSignals = RiskAssessmentSignals;
export type RiskWeights = RiskAssessmentWeights;

export interface RiskScoreResult {
  score: number;
  floorApplied: boolean;
}

/** Default weights matching research.md §R-07.5 — must sum to 1.00. */
export const DEFAULT_WEIGHTS: RiskWeights = {
  recentPnlStreak: 0.2,
  marketContext: 0.15,
  similarHistoryLossRate: 0.25,
  tilt: 0.2,
  propFirmRoom: 0.2,
};

/** Tilt color → signal value. */
export const TILT_GREEN = 0;
export const TILT_YELLOW = 50;
export const TILT_RED = 100;

/** Minimum score when tilt is Red (FR-025, SC-008). */
export const TILT_RED_FLOOR = 70;

const SIGNAL_KEYS = [
  'recentPnlStreak',
  'marketContext',
  'similarHistoryLossRate',
  'tilt',
  'propFirmRoom',
] as const;

type SignalKey = (typeof SIGNAL_KEYS)[number];

function clampSignal(v: number): number {
  if (!Number.isFinite(v)) return 0;
  return Math.max(0, Math.min(100, v));
}

function clamp100(v: number): number {
  if (!Number.isFinite(v)) return 0;
  return Math.max(0, Math.min(100, Math.round(v)));
}

/**
 * Redistribute a base weight set so signals marked `null` in `signals`
 * contribute 0 and the remaining signals' weights are renormalized to
 * sum to 1.0. The redistribution is proportional to the original weights
 * — no signal "jumps ahead" of another.
 */
function redistributeWeights(
  base: RiskWeights,
  signals: { tilt: number | null; propFirmRoom: number | null },
): RiskWeights {
  const presentMask: Record<SignalKey, boolean> = {
    recentPnlStreak: true,
    marketContext: true,
    similarHistoryLossRate: true,
    tilt: signals.tilt !== null,
    propFirmRoom: signals.propFirmRoom !== null,
  };

  let presentSum = 0;
  for (const k of SIGNAL_KEYS) {
    if (presentMask[k]) presentSum += base[k];
  }
  // Defensive: if every signal is absent, fall back to zeros — caller will
  // get score = 0 deterministically.
  if (presentSum <= 0) {
    return {
      recentPnlStreak: 0,
      marketContext: 0,
      similarHistoryLossRate: 0,
      tilt: 0,
      propFirmRoom: 0,
    };
  }

  const out: RiskWeights = {
    recentPnlStreak: 0,
    marketContext: 0,
    similarHistoryLossRate: 0,
    tilt: 0,
    propFirmRoom: 0,
  };
  for (const k of SIGNAL_KEYS) {
    out[k] = presentMask[k] ? base[k] / presentSum : 0;
  }
  return out;
}

/**
 * Compute the final 0..100 risk score from 5 signals and a weight table.
 *
 * Inputs:
 *   - signals.recentPnlStreak, marketContext, similarHistoryLossRate: always 0..100
 *   - signals.tilt: 0/50/100 OR null (no active check-in)
 *   - signals.propFirmRoom: 0..100 OR null (no active profile)
 *
 * Behavior:
 *   - Null signals contribute 0 AND their weight is redistributed proportionally.
 *   - Final score is rounded and clamped to [0, 100].
 *   - If tilt === 100, the result is at least TILT_RED_FLOOR (FR-025).
 */
export function computeRiskScore(signals: RiskSignals, weights: RiskWeights): RiskScoreResult {
  const effective = redistributeWeights(weights, signals);

  const recent = clampSignal(signals.recentPnlStreak) * effective.recentPnlStreak;
  const market = clampSignal(signals.marketContext) * effective.marketContext;
  const similar = clampSignal(signals.similarHistoryLossRate) * effective.similarHistoryLossRate;
  const tilt = signals.tilt === null ? 0 : clampSignal(signals.tilt) * effective.tilt;
  const propFirm =
    signals.propFirmRoom === null ? 0 : clampSignal(signals.propFirmRoom) * effective.propFirmRoom;

  const weighted = recent + market + similar + tilt + propFirm;
  let score = clamp100(weighted);
  let floorApplied = false;
  if (signals.tilt === TILT_RED && score < TILT_RED_FLOOR) {
    score = TILT_RED_FLOOR;
    floorApplied = true;
  }
  return { score, floorApplied };
}

/** Public helper — same redistribution policy used by the score function. */
export function effectiveWeights(
  base: RiskWeights,
  signals: { tilt: number | null; propFirmRoom: number | null },
): RiskWeights {
  return redistributeWeights(base, signals);
}
