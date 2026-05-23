/**
 * Risk-score weight redistribution math.
 *
 * Locks the proportional renormalization contract from contracts/risk-api.md:
 *   - When `tilt` or `propFirmRoom` is null, its weight is redistributed
 *     to the remaining signals PROPORTIONALLY to their original weights.
 *   - The remaining weights always sum to exactly 1.0 (within float).
 */

import { describe, expect, it } from 'vitest';

import { DEFAULT_WEIGHTS, effectiveWeights, type RiskWeights } from '@/lib/scoring/risk';

function sumWeights(w: RiskWeights): number {
  return w.recentPnlStreak + w.marketContext + w.similarHistoryLossRate + w.tilt + w.propFirmRoom;
}

describe('effectiveWeights — default 5-signal table', () => {
  it('vector matches research.md §R-07.5', () => {
    expect(DEFAULT_WEIGHTS).toEqual({
      recentPnlStreak: 0.2,
      marketContext: 0.15,
      similarHistoryLossRate: 0.25,
      tilt: 0.2,
      propFirmRoom: 0.2,
    });
  });
});

describe('effectiveWeights — tilt === null', () => {
  it('redistributes proportionally; tilt drops to 0; others scale by 1/0.80', () => {
    const w = effectiveWeights(DEFAULT_WEIGHTS, { tilt: null, propFirmRoom: 0 });
    expect(w.tilt).toBe(0);
    expect(w.recentPnlStreak).toBeCloseTo(0.2 / 0.8, 10); // 0.25
    expect(w.marketContext).toBeCloseTo(0.15 / 0.8, 10); // 0.1875
    expect(w.similarHistoryLossRate).toBeCloseTo(0.25 / 0.8, 10); // 0.3125
    expect(w.propFirmRoom).toBeCloseTo(0.2 / 0.8, 10); // 0.25
    expect(sumWeights(w)).toBeCloseTo(1.0, 10);
  });
});

describe('effectiveWeights — propFirmRoom === null', () => {
  it('redistributes proportionally; propFirmRoom drops to 0; others scale by 1/0.80', () => {
    const w = effectiveWeights(DEFAULT_WEIGHTS, { tilt: 0, propFirmRoom: null });
    expect(w.propFirmRoom).toBe(0);
    expect(w.recentPnlStreak).toBeCloseTo(0.2 / 0.8, 10);
    expect(w.marketContext).toBeCloseTo(0.15 / 0.8, 10);
    expect(w.similarHistoryLossRate).toBeCloseTo(0.25 / 0.8, 10);
    expect(w.tilt).toBeCloseTo(0.2 / 0.8, 10);
    expect(sumWeights(w)).toBeCloseTo(1.0, 10);
  });
});

describe('effectiveWeights — both tilt + propFirmRoom null', () => {
  it('redistributes proportionally across the remaining 3 signals; sum = 1.0', () => {
    const w = effectiveWeights(DEFAULT_WEIGHTS, { tilt: null, propFirmRoom: null });
    expect(w.tilt).toBe(0);
    expect(w.propFirmRoom).toBe(0);
    // Remaining base sum = 0.2 + 0.15 + 0.25 = 0.60
    expect(w.recentPnlStreak).toBeCloseTo(0.2 / 0.6, 10); // ~0.333
    expect(w.marketContext).toBeCloseTo(0.15 / 0.6, 10); // 0.25
    expect(w.similarHistoryLossRate).toBeCloseTo(0.25 / 0.6, 10); // ~0.417
    expect(sumWeights(w)).toBeCloseTo(1.0, 10);
  });
});

describe('effectiveWeights — degenerate inputs', () => {
  it('does not mutate the input weights table', () => {
    const w = { ...DEFAULT_WEIGHTS };
    effectiveWeights(w, { tilt: null, propFirmRoom: null });
    expect(w).toEqual(DEFAULT_WEIGHTS);
  });
});
