/**
 * Risk Score — pure-function unit tests.
 *
 * Validates research.md R-07.5 against golden boundary fixtures so SC-002
 * (결정론 100%) has a first-line regression net, and SC-008 (Tilt-Red floor)
 * is enforced even when other signals are zero.
 */

import { describe, expect, it } from 'vitest';

import {
  DEFAULT_WEIGHTS,
  TILT_GREEN,
  TILT_RED,
  TILT_RED_FLOOR,
  TILT_YELLOW,
  computeRiskScore,
  effectiveWeights,
  type RiskSignals,
  type RiskWeights,
} from '@/lib/scoring/risk';

function sumWeights(w: RiskWeights): number {
  return w.recentPnlStreak + w.marketContext + w.similarHistoryLossRate + w.tilt + w.propFirmRoom;
}

const ZERO_SIGNALS: RiskSignals = {
  recentPnlStreak: 0,
  marketContext: 0,
  similarHistoryLossRate: 0,
  tilt: TILT_GREEN,
  propFirmRoom: 0,
};

describe('DEFAULT_WEIGHTS', () => {
  it('sums to 1.0 (research.md §R-07.5 contract)', () => {
    expect(sumWeights(DEFAULT_WEIGHTS)).toBeCloseTo(1.0, 10);
  });
});

describe('computeRiskScore — Tilt-Red floor (SC-008 / FR-025)', () => {
  it('forces score >= 70 when tilt === TILT_RED with all other signals at 0', () => {
    const signals: RiskSignals = { ...ZERO_SIGNALS, tilt: TILT_RED };
    const { score, floorApplied } = computeRiskScore(signals, DEFAULT_WEIGHTS);
    expect(score).toBeGreaterThanOrEqual(TILT_RED_FLOOR);
    expect(floorApplied).toBe(true);
  });

  it('does NOT apply the floor when tilt is Yellow', () => {
    const signals: RiskSignals = { ...ZERO_SIGNALS, tilt: TILT_YELLOW };
    const { score, floorApplied } = computeRiskScore(signals, DEFAULT_WEIGHTS);
    expect(floorApplied).toBe(false);
    expect(score).toBeLessThan(TILT_RED_FLOOR);
  });

  it('does NOT apply the floor when tilt is null (absent)', () => {
    const signals: RiskSignals = { ...ZERO_SIGNALS, tilt: null };
    const { score, floorApplied } = computeRiskScore(signals, DEFAULT_WEIGHTS);
    expect(floorApplied).toBe(false);
    expect(score).toBe(0);
  });

  it('keeps a higher computed score even when Tilt-Red floor would apply', () => {
    // All signals max → 100 already. Floor must not reduce.
    const signals: RiskSignals = {
      recentPnlStreak: 100,
      marketContext: 100,
      similarHistoryLossRate: 100,
      tilt: TILT_RED,
      propFirmRoom: 100,
    };
    const { score, floorApplied } = computeRiskScore(signals, DEFAULT_WEIGHTS);
    expect(score).toBe(100);
    // Floor was not the binding constraint here, but the spec just requires
    // the result to be >= 70; we surface floorApplied iff it changed the value.
    expect(floorApplied).toBe(false);
  });
});

describe('computeRiskScore — weight redistribution', () => {
  it('tilt === null: remaining 4 weights sum to 1.0', () => {
    const signals: RiskSignals = { ...ZERO_SIGNALS, tilt: null };
    const w = effectiveWeights(DEFAULT_WEIGHTS, signals);
    expect(w.tilt).toBe(0);
    expect(sumWeights(w)).toBeCloseTo(1.0, 10);
  });

  it('propFirmRoom === null + tilt === null: remaining 3 weights sum to 1.0', () => {
    const signals: RiskSignals = { ...ZERO_SIGNALS, tilt: null, propFirmRoom: null };
    const w = effectiveWeights(DEFAULT_WEIGHTS, signals);
    expect(w.tilt).toBe(0);
    expect(w.propFirmRoom).toBe(0);
    expect(sumWeights(w)).toBeCloseTo(1.0, 10);
  });

  it('all 5 signals present: weights equal DEFAULT_WEIGHTS exactly', () => {
    const w = effectiveWeights(DEFAULT_WEIGHTS, { tilt: 0, propFirmRoom: 0 });
    expect(w).toEqual(DEFAULT_WEIGHTS);
  });
});

describe('computeRiskScore — extremes', () => {
  it('all signals = 100 → score = 100', () => {
    const signals: RiskSignals = {
      recentPnlStreak: 100,
      marketContext: 100,
      similarHistoryLossRate: 100,
      tilt: 100,
      propFirmRoom: 100,
    };
    expect(computeRiskScore(signals, DEFAULT_WEIGHTS).score).toBe(100);
  });

  it('all signals = 0 → score = 0', () => {
    const signals: RiskSignals = {
      recentPnlStreak: 0,
      marketContext: 0,
      similarHistoryLossRate: 0,
      tilt: 0,
      propFirmRoom: 0,
    };
    expect(computeRiskScore(signals, DEFAULT_WEIGHTS).score).toBe(0);
  });

  it('out-of-range signals are clamped to [0, 100]', () => {
    const signals: RiskSignals = {
      recentPnlStreak: 250,
      marketContext: -40,
      similarHistoryLossRate: 9999,
      tilt: null,
      propFirmRoom: null,
    };
    const { score } = computeRiskScore(signals, DEFAULT_WEIGHTS);
    expect(score).toBeLessThanOrEqual(100);
    expect(score).toBeGreaterThanOrEqual(0);
  });
});

describe('computeRiskScore — determinism (SC-002)', () => {
  it('returns identical result across 100 calls', () => {
    const signals: RiskSignals = {
      recentPnlStreak: 30,
      marketContext: 40,
      similarHistoryLossRate: 70,
      tilt: TILT_YELLOW,
      propFirmRoom: 60,
    };
    const first = computeRiskScore(signals, DEFAULT_WEIGHTS);
    for (let i = 0; i < 100; i += 1) {
      const r = computeRiskScore(signals, DEFAULT_WEIGHTS);
      expect(r.score).toBe(first.score);
      expect(r.floorApplied).toBe(first.floorApplied);
    }
  });

  it('does not mutate the supplied weights object', () => {
    const w = { ...DEFAULT_WEIGHTS };
    computeRiskScore({ ...ZERO_SIGNALS, tilt: null, propFirmRoom: null }, w);
    expect(w).toEqual(DEFAULT_WEIGHTS);
  });
});
