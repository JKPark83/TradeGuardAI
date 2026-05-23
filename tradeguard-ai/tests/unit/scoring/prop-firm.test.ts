/**
 * Prop firm drawdown + daily-loss-room — pure-function unit tests.
 *
 * Validates research.md §R-08 golden formulas:
 *   Static:    floor = accountSize - drawdownLimit
 *   EOD:       floor = max(eodHistory) - drawdownLimit
 *   Intraday:  floor = max(equityCurve) - drawdownLimit
 *
 * SC-002 (결정론 100%) requires byte-identical output for the same input.
 */

import { describe, it, expect } from 'vitest';

import {
  computeStaticDrawdown,
  computeEodTrailingDrawdown,
  computeIntradayTrailingDrawdown,
  computeDailyLossRoom,
  evaluateRoom,
} from '@/lib/scoring/prop-firm';
import type { PropFirmProfile } from '@/types/db';

// ---- Static drawdown ----------------------------------------------------

describe('computeStaticDrawdown — R-08.1', () => {
  it('safe: account=50000, limit=2000, equity=48500 → room=500', () => {
    const r = computeStaticDrawdown({
      accountSize: 50000,
      drawdownLimit: 2000,
      currentEquity: 48500,
    });
    expect(r.floor).toBe(48000);
    expect(r.room).toBe(500);
    expect(r.breach).toBe(false);
  });

  it('80% used: account=50000, limit=2000, equity=48400 → room=400', () => {
    const r = computeStaticDrawdown({
      accountSize: 50000,
      drawdownLimit: 2000,
      currentEquity: 48400,
    });
    expect(r.floor).toBe(48000);
    expect(r.room).toBe(400);
    expect(r.breach).toBe(false);
  });

  it('breach: account=50000, limit=2000, equity=47999 → breach=true', () => {
    const r = computeStaticDrawdown({
      accountSize: 50000,
      drawdownLimit: 2000,
      currentEquity: 47999,
    });
    expect(r.floor).toBe(48000);
    expect(r.room).toBe(-1);
    expect(r.breach).toBe(true);
  });
});

// ---- EOD trailing -------------------------------------------------------

describe('computeEodTrailingDrawdown — R-08.2', () => {
  it('safe: history=[50000,50500,50300], limit=2000, equity=49000 → floor=48500 room=500', () => {
    const r = computeEodTrailingDrawdown({
      eodBalanceHistory: [50000, 50500, 50300],
      drawdownLimit: 2000,
      currentEquity: 49000,
    });
    expect(r.floor).toBe(48500);
    expect(r.room).toBe(500);
    expect(r.breach).toBe(false);
  });

  it('80% used: peak=50500, limit=2000, equity=48600 → room=100', () => {
    const r = computeEodTrailingDrawdown({
      eodBalanceHistory: [50000, 50500, 50300],
      drawdownLimit: 2000,
      currentEquity: 48600,
    });
    expect(r.floor).toBe(48500);
    expect(r.room).toBe(100);
    expect(r.breach).toBe(false);
  });

  it('breach: peak=50500, limit=2000, equity=48000 → breach=true', () => {
    const r = computeEodTrailingDrawdown({
      eodBalanceHistory: [50000, 50500, 50300],
      drawdownLimit: 2000,
      currentEquity: 48000,
    });
    expect(r.floor).toBe(48500);
    expect(r.room).toBe(-500);
    expect(r.breach).toBe(true);
  });

  it('empty history falls back to currentEquity as peak (new account)', () => {
    const r = computeEodTrailingDrawdown({
      eodBalanceHistory: [],
      drawdownLimit: 2000,
      currentEquity: 50000,
    });
    expect(r.floor).toBe(48000);
    expect(r.room).toBe(2000);
    expect(r.breach).toBe(false);
  });
});

// ---- Intraday trailing --------------------------------------------------

describe('computeIntradayTrailingDrawdown — R-08.3', () => {
  it('safe: curve=[50000,50800,50300], limit=2000, equity=49500 → floor=48800 room=700', () => {
    const r = computeIntradayTrailingDrawdown({
      equityCurve: [50000, 50800, 50300],
      drawdownLimit: 2000,
      currentEquity: 49500,
    });
    expect(r.floor).toBe(48800);
    expect(r.room).toBe(700);
    expect(r.breach).toBe(false);
  });

  it('80% used: peak=50800, limit=2000, equity=49200 → room=400', () => {
    const r = computeIntradayTrailingDrawdown({
      equityCurve: [50000, 50800, 50300],
      drawdownLimit: 2000,
      currentEquity: 49200,
    });
    expect(r.floor).toBe(48800);
    expect(r.room).toBe(400);
    expect(r.breach).toBe(false);
  });

  it('breach: peak=50800, limit=2000, equity=48700 → breach=true', () => {
    const r = computeIntradayTrailingDrawdown({
      equityCurve: [50000, 50800, 50300],
      drawdownLimit: 2000,
      currentEquity: 48700,
    });
    expect(r.floor).toBe(48800);
    expect(r.room).toBe(-100);
    expect(r.breach).toBe(true);
  });
});

// ---- Daily loss --------------------------------------------------------

describe('computeDailyLossRoom', () => {
  it('limit=1000, todayLoss=800 → room=200 usedPct=0.8', () => {
    const r = computeDailyLossRoom({ todayRealizedLoss: 800, dailyLossLimit: 1000 });
    expect(r.room).toBe(200);
    expect(r.usedPct).toBeCloseTo(0.8, 10);
  });

  it('limit=1000, todayLoss=0 → room=1000 usedPct=0', () => {
    const r = computeDailyLossRoom({ todayRealizedLoss: 0, dailyLossLimit: 1000 });
    expect(r.room).toBe(1000);
    expect(r.usedPct).toBe(0);
  });

  it('limit=null → room=null usedPct=null', () => {
    const r = computeDailyLossRoom({ todayRealizedLoss: 500, dailyLossLimit: null });
    expect(r.room).toBeNull();
    expect(r.usedPct).toBeNull();
  });

  it('zero limit treated as no rule (null,null)', () => {
    const r = computeDailyLossRoom({ todayRealizedLoss: 100, dailyLossLimit: 0 });
    expect(r.room).toBeNull();
    expect(r.usedPct).toBeNull();
  });
});

// ---- Orchestrator: evaluateRoom ----------------------------------------

function makeProfile(overrides: Partial<PropFirmProfile> = {}): PropFirmProfile {
  return {
    id: 'profile-1',
    owner_id: 'user-1',
    firm_name: 'topstep',
    firm_label: 'Topstep 50K',
    account_size: '50000',
    daily_loss_limit: '1000',
    drawdown_type: 'eod_trailing',
    drawdown_limit: '2000',
    warn_threshold_pct: '0.80',
    is_active: true,
    created_at: '2026-05-23T00:00:00Z',
    ...overrides,
  };
}

describe('evaluateRoom — orchestrator', () => {
  it('eod_trailing: full integration with daily loss', () => {
    const profile = makeProfile({ drawdown_type: 'eod_trailing' });
    const room = evaluateRoom(profile, {
      eodBalances: [50000, 50500, 50300],
      currentEquity: 49000,
      todayRealizedLoss: 500,
      equityCurveIntraday: [],
    });
    expect(room.drawdownFloor).toBe(48500);
    expect(room.drawdownRoom).toBe(500);
    expect(room.dailyLossRoom).toBe(500);
    expect(room.dailyLossUsedPct).toBeCloseTo(0.5, 10);
    expect(room.currentEquity).toBe(49000);
    // dailyUsed 0.5 < 0.8, drawdownRoom/limit 0.25 >= 0.20 → no warning
    expect(room.warningActive).toBe(false);
  });

  it('static: picks computeStaticDrawdown', () => {
    const profile = makeProfile({ drawdown_type: 'static' });
    const room = evaluateRoom(profile, {
      eodBalances: [99999], // ignored
      currentEquity: 49000,
      todayRealizedLoss: 0,
      equityCurveIntraday: [],
    });
    expect(room.drawdownFloor).toBe(48000);
    expect(room.drawdownRoom).toBe(1000);
  });

  it('intraday_trailing: picks computeIntradayTrailingDrawdown', () => {
    const profile = makeProfile({ drawdown_type: 'intraday_trailing' });
    const room = evaluateRoom(profile, {
      eodBalances: [],
      currentEquity: 49500,
      todayRealizedLoss: 0,
      equityCurveIntraday: [50000, 50800, 50300],
    });
    expect(room.drawdownFloor).toBe(48800);
    expect(room.drawdownRoom).toBe(700);
  });

  it('null daily limit yields null dailyLossRoom + does not contribute to warning', () => {
    const profile = makeProfile({ daily_loss_limit: null });
    const room = evaluateRoom(profile, {
      eodBalances: [50000],
      currentEquity: 50000,
      todayRealizedLoss: 800,
      equityCurveIntraday: [],
    });
    expect(room.dailyLossRoom).toBeNull();
    expect(room.dailyLossUsedPct).toBeNull();
    expect(room.warningActive).toBe(false);
  });
});

// ---- Determinism --------------------------------------------------------

describe('determinism', () => {
  it('100 calls of evaluateRoom return identical output', () => {
    const profile = makeProfile();
    const ctx = {
      eodBalances: [50000, 50500, 50300],
      currentEquity: 49000,
      todayRealizedLoss: 500,
      equityCurveIntraday: [],
    };
    const first = JSON.stringify(evaluateRoom(profile, ctx));
    for (let i = 0; i < 99; i++) {
      expect(JSON.stringify(evaluateRoom(profile, ctx))).toBe(first);
    }
  });
});
