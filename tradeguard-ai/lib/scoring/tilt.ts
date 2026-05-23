// Deterministic Tilt Score (Green / Yellow / Red).
//
// Contract: pure (no Date.now, no Math.random, no I/O). Same input → same output.
// Formula is transcribed verbatim from research.md §R-07.4 — DO NOT tweak
// thresholds or coefficients without updating R-07.4 and the golden tests
// (tests/unit/scoring/tilt.test.ts) together.
//
// R-07.4:
//   sleep_score: 1~10 (user input)
//   stress_score: 1~10 (user input)
//   flag = 1 if (externalEventSerious is true) else 0
//
//   raw = (10 - sleep_score) * 1.5 + stress_score * 1.2 + flag * 5
//   if raw <= 8:  Green
//   elif raw <= 18: Yellow
//   else: Red

import type { TiltColor } from '@/types/db';

export interface TiltScoreArgs {
  /** Self-reported sleep quality, integer in [1, 10]. */
  sleepScore: number;
  /** Self-reported stress level, integer in [1, 10]. */
  stressScore: number;
  /** True iff the user marked the recent external event as "serious". */
  externalEventSerious: boolean;
}

export interface TiltScoreResult {
  color: TiltColor;
  rawScore: number;
}

/** Boundary thresholds — exclusive comparisons honor "<= 8 → green". */
const GREEN_MAX = 8;
const YELLOW_MAX = 18;

/** Score input domain. */
const SCORE_MIN = 1;
const SCORE_MAX = 10;

/** Throws if the input is out of the R-07.4 input domain. */
function assertScoreInRange(name: string, value: number): void {
  if (!Number.isInteger(value)) {
    throw new Error(`tilt: ${name} must be an integer, got ${value}`);
  }
  if (value < SCORE_MIN || value > SCORE_MAX) {
    throw new Error(`tilt: ${name} must be in [${SCORE_MIN}, ${SCORE_MAX}], got ${value}`);
  }
}

/**
 * Compute the deterministic Tilt Score from user check-in inputs.
 *
 * Pure function — no I/O, no clock, no randomness. SC-002 requires byte-
 * identical results across runs for the same input.
 *
 * @throws if sleepScore or stressScore is not an integer in [1, 10].
 */
export function computeTiltScore(args: TiltScoreArgs): TiltScoreResult {
  const { sleepScore, stressScore, externalEventSerious } = args;
  assertScoreInRange('sleepScore', sleepScore);
  assertScoreInRange('stressScore', stressScore);

  const flag = externalEventSerious ? 1 : 0;
  const raw = (10 - sleepScore) * 1.5 + stressScore * 1.2 + flag * 5;

  const color: TiltColor = raw <= GREEN_MAX ? 'green' : raw <= YELLOW_MAX ? 'yellow' : 'red';

  return { color, rawScore: raw };
}

/**
 * Korean recommendations surfaced alongside the color in `TiltSubmitResponse`.
 * Wording is product copy — change only with PM approval (FR-024 UX contract).
 */
export function tiltRecommendations(color: TiltColor): string[] {
  switch (color) {
    case 'green':
      return ['정상 상태. 평소대로 거래하세요.'];
    case 'yellow':
      return ['사이즈 50% 감소 권고', '거래 횟수 2건 이하로 제한'];
    case 'red':
      return ['거래 중단 권고', '오늘은 시장 관찰만 하세요'];
  }
}
