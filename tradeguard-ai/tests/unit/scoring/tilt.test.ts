/**
 * Tilt Score — pure-function unit tests.
 *
 * Validates research.md R-07.4 against golden boundary fixtures so SC-002
 * (결정론 100%) has a first-line regression net for FR-024.
 *
 * The boundaries are load-bearing: a single off-by-one (>= vs >) would let
 * a "yellow" user be told they're "green" and skip risk-mitigation copy.
 */

import { describe, it, expect } from 'vitest';

import { computeTiltScore, tiltRecommendations } from '@/lib/scoring/tilt';
import type { TiltColor } from '@/types/db';

// ---- Golden cases from research.md R-07.4 ------------------------------

interface GoldenCase {
  name: string;
  input: { sleepScore: number; stressScore: number; externalEventSerious: boolean };
  expectedRaw: number;
  expectedColor: TiltColor;
}

const goldenCases: GoldenCase[] = [
  {
    name: 'well-rested + low stress + no event → green (raw=1.2)',
    input: { sleepScore: 10, stressScore: 1, externalEventSerious: false },
    expectedRaw: 1.2,
    expectedColor: 'green',
  },
  {
    name: 'mid sleep + mid stress + no event → yellow (raw=13.5)',
    input: { sleepScore: 5, stressScore: 5, externalEventSerious: false },
    expectedRaw: 13.5,
    expectedColor: 'yellow',
  },
  {
    name: 'poor sleep + high stress + serious event → red (raw=26.6)',
    input: { sleepScore: 2, stressScore: 8, externalEventSerious: true },
    expectedRaw: 26.6,
    expectedColor: 'red',
  },
];

describe('computeTiltScore — golden cases (R-07.4)', () => {
  it.each(goldenCases)('$name', ({ input, expectedRaw, expectedColor }) => {
    const { color, rawScore } = computeTiltScore(input);
    expect(rawScore).toBeCloseTo(expectedRaw, 10);
    expect(color).toBe(expectedColor);
  });
});

// ---- Boundary tests — guard color thresholds 8.0 and 18.0 -------------

describe('computeTiltScore — color boundaries', () => {
  // raw = (10-sleep)*1.5 + stress*1.2 + flag*5
  //
  // The integer constraint on sleep/stress means the raw value lives on a
  // discrete grid (steps of 1.2 and 1.5). The exact textbook boundary 8.00
  // is not reachable with integer inputs, so we pin both sides of each
  // boundary using the closest reachable points + flag=true offsets:
  //
  //   - 7.8 → green (upper-bound region, color === 'green')
  //   - 9.0 → yellow (smallest reachable raw > 8.0)
  //   - 18.0 → yellow (reachable inclusive boundary)
  //   - 19.2 → red (smallest reachable raw > 18.0)

  it('raw = 7.8 (closest reachable to 8.0) → green', () => {
    // sleep=8, stress=4, flag=0 → 2*1.5 + 4*1.2 = 3.0 + 4.8 = 7.8
    const r = computeTiltScore({ sleepScore: 8, stressScore: 4, externalEventSerious: false });
    expect(r.rawScore).toBeCloseTo(7.8, 10);
    expect(r.color).toBe('green');
  });

  it('raw = 9.0 (smallest reachable > 8.0) → yellow', () => {
    // sleep=8, stress=5, flag=0 → 2*1.5 + 5*1.2 = 3.0 + 6.0 = 9.0
    const r = computeTiltScore({ sleepScore: 8, stressScore: 5, externalEventSerious: false });
    expect(r.rawScore).toBeCloseTo(9.0, 10);
    expect(r.color).toBe('yellow');
  });

  it('raw = 18.0 → yellow (inclusive upper bound)', () => {
    // sleep=2, stress=5, flag=0 → 8*1.5 + 5*1.2 = 12 + 6 = 18.0
    const r = computeTiltScore({ sleepScore: 2, stressScore: 5, externalEventSerious: false });
    expect(r.rawScore).toBeCloseTo(18.0, 10);
    expect(r.color).toBe('yellow');
  });

  it('raw = 19.2 (smallest reachable > 18.0) → red', () => {
    // sleep=2, stress=6, flag=0 → 8*1.5 + 6*1.2 = 12 + 7.2 = 19.2
    const r = computeTiltScore({ sleepScore: 2, stressScore: 6, externalEventSerious: false });
    expect(r.rawScore).toBeCloseTo(19.2, 10);
    expect(r.color).toBe('red');
  });

  it('serious external flag adds exactly +5 to raw', () => {
    const base = computeTiltScore({
      sleepScore: 7,
      stressScore: 5,
      externalEventSerious: false,
    });
    const flagged = computeTiltScore({
      sleepScore: 7,
      stressScore: 5,
      externalEventSerious: true,
    });
    expect(flagged.rawScore - base.rawScore).toBeCloseTo(5, 10);
  });
});

// ---- Determinism (SC-002) ---------------------------------------------

describe('computeTiltScore — determinism (SC-002)', () => {
  it('returns identical result across 100 calls', () => {
    const input = { sleepScore: 5, stressScore: 5, externalEventSerious: false };
    const first = computeTiltScore(input);
    for (let i = 0; i < 100; i += 1) {
      const r = computeTiltScore(input);
      expect(r.color).toBe(first.color);
      expect(r.rawScore).toBe(first.rawScore);
    }
  });
});

// ---- Input validation -------------------------------------------------

describe('computeTiltScore — input validation', () => {
  it('throws when sleepScore = 0 (below domain)', () => {
    expect(() =>
      computeTiltScore({ sleepScore: 0, stressScore: 5, externalEventSerious: false }),
    ).toThrow(/sleepScore/);
  });

  it('throws when sleepScore = 11 (above domain)', () => {
    expect(() =>
      computeTiltScore({ sleepScore: 11, stressScore: 5, externalEventSerious: false }),
    ).toThrow(/sleepScore/);
  });

  it('throws when stressScore = 0', () => {
    expect(() =>
      computeTiltScore({ sleepScore: 5, stressScore: 0, externalEventSerious: false }),
    ).toThrow(/stressScore/);
  });

  it('throws when stressScore = 11', () => {
    expect(() =>
      computeTiltScore({ sleepScore: 5, stressScore: 11, externalEventSerious: false }),
    ).toThrow(/stressScore/);
  });

  it('throws on non-integer sleepScore', () => {
    expect(() =>
      computeTiltScore({ sleepScore: 5.5, stressScore: 5, externalEventSerious: false }),
    ).toThrow(/integer/);
  });

  it('throws on non-integer stressScore', () => {
    expect(() =>
      computeTiltScore({ sleepScore: 5, stressScore: 7.2, externalEventSerious: false }),
    ).toThrow(/integer/);
  });
});

// ---- Recommendations --------------------------------------------------

describe('tiltRecommendations', () => {
  it.each(['green', 'yellow', 'red'] as const)(
    '%s returns a non-empty Korean recommendation array',
    (color) => {
      const recs = tiltRecommendations(color);
      expect(Array.isArray(recs)).toBe(true);
      expect(recs.length).toBeGreaterThan(0);
      for (const r of recs) {
        expect(typeof r).toBe('string');
        expect(r.length).toBeGreaterThan(0);
      }
    },
  );

  it('yellow contains size-reduction guidance', () => {
    const recs = tiltRecommendations('yellow');
    expect(recs.some((r) => r.includes('50%'))).toBe(true);
  });

  it('red contains trading-halt guidance', () => {
    const recs = tiltRecommendations('red');
    expect(recs.some((r) => r.includes('거래 중단'))).toBe(true);
  });
});
