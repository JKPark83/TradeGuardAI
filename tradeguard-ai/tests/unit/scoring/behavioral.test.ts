/**
 * Behavioral scoring — pure-function unit tests.
 *
 * Validates research.md R-07 (Stop-Delay, Revenge, Overconfidence) against
 * golden fixtures so SC-002 (결정론 100%) has a first-line regression net.
 *
 * NOTE: Tests target spec behavior, not implementation. If a sibling agent
 * rewrites the function body but keeps the contract, these tests still pass.
 */

import { describe, it, expect } from 'vitest';

import {
  computeStopDelayScore,
  computeRevengeScore,
  computeOverconfidenceScore,
} from '@/lib/scoring/behavioral';

import stopDelayCases from '@/tests/fixtures/golden/behavioral/stop-delay.json';
import revengeCases from '@/tests/fixtures/golden/behavioral/revenge.json';
import overconfidenceCases from '@/tests/fixtures/golden/behavioral/overconfidence.json';

// ---- Fixture type guards -----------------------------------------------

interface StopDelayCase {
  name: string;
  input: { holdingMinutes: number; userAvgHoldingMinutes30d: number; pnl: number };
  expected: number;
}

interface RevengeCase {
  name: string;
  input: { prevConsecutiveLossCount: number; gapMinutesSincePrevLoss: number };
  expected: number;
}

interface OverconfidenceCase {
  name: string;
  input: {
    prevPnl: number;
    contracts: number;
    userMedianContracts30d: number;
    winStreak: number;
  };
  expected: number;
}

const stopDelay = stopDelayCases as StopDelayCase[];
const revenge = revengeCases as RevengeCase[];
const overconfidence = overconfidenceCases as OverconfidenceCase[];

// ---- Golden table-driven tests ----------------------------------------

describe('computeStopDelayScore — golden fixtures (R-07 §7.1)', () => {
  it.each(stopDelay)('$name', ({ input, expected }) => {
    expect(computeStopDelayScore(input)).toBe(expected);
  });
});

describe('computeRevengeScore — golden fixtures (R-07 §7.2)', () => {
  it.each(revenge)('$name', ({ input, expected }) => {
    expect(computeRevengeScore(input)).toBe(expected);
  });
});

describe('computeOverconfidenceScore — golden fixtures (R-07 §7.3)', () => {
  it.each(overconfidence)('$name', ({ input, expected }) => {
    expect(computeOverconfidenceScore(input)).toBe(expected);
  });
});

// ---- Determinism (SC-002) ---------------------------------------------

describe('determinism — same input always yields same output (SC-002)', () => {
  it('computeStopDelayScore returns identical value across 100 calls', () => {
    const input = { holdingMinutes: 120, userAvgHoldingMinutes30d: 30, pnl: -100 };
    const first = computeStopDelayScore(input);
    const outputs = Array.from({ length: 100 }, () => computeStopDelayScore(input));
    expect(outputs.every((v) => v === first)).toBe(true);
  });

  it('computeRevengeScore returns identical value across 100 calls', () => {
    const input = { prevConsecutiveLossCount: 2, gapMinutesSincePrevLoss: 5 };
    const first = computeRevengeScore(input);
    const outputs = Array.from({ length: 100 }, () => computeRevengeScore(input));
    expect(outputs.every((v) => v === first)).toBe(true);
  });

  it('computeOverconfidenceScore returns identical value across 100 calls', () => {
    const input = { prevPnl: 200, contracts: 4, userMedianContracts30d: 2, winStreak: 1 };
    const first = computeOverconfidenceScore(input);
    const outputs = Array.from({ length: 100 }, () => computeOverconfidenceScore(input));
    expect(outputs.every((v) => v === first)).toBe(true);
  });
});

// ---- Boundary / clamp tests -------------------------------------------

describe('boundary — all scores clamp to [0, 100]', () => {
  it('stop-delay clamps extreme holding ratio to 100', () => {
    const score = computeStopDelayScore({
      holdingMinutes: 100_000,
      userAvgHoldingMinutes30d: 1,
      pnl: -500,
    });
    expect(score).toBeGreaterThanOrEqual(0);
    expect(score).toBeLessThanOrEqual(100);
    expect(score).toBe(100);
  });

  it('stop-delay never returns below 0', () => {
    const score = computeStopDelayScore({
      holdingMinutes: 0,
      userAvgHoldingMinutes30d: 30,
      pnl: 500,
    });
    expect(score).toBeGreaterThanOrEqual(0);
  });

  it('revenge score stays in [0, 100] for all fixtures', () => {
    for (const c of revenge) {
      const score = computeRevengeScore(c.input);
      expect(score).toBeGreaterThanOrEqual(0);
      expect(score).toBeLessThanOrEqual(100);
    }
  });

  it('overconfidence score stays in [0, 100] for all fixtures', () => {
    for (const c of overconfidence) {
      const score = computeOverconfidenceScore(c.input);
      expect(score).toBeGreaterThanOrEqual(0);
      expect(score).toBeLessThanOrEqual(100);
    }
  });
});
