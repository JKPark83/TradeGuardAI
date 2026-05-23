/**
 * Daily-loss + warning-threshold boundary tests for prop-firm scoring.
 *
 * SC-009: when dailyLossUsedPct >= warnThresholdPct, the room's warningActive
 * MUST be true. This file pins the boundary so a >=/> off-by-one regression
 * surfaces immediately.
 */

import { describe, it, expect } from 'vitest';

import { computeDailyLossRoom, evaluateRoom } from '@/lib/scoring/prop-firm';
import type { PropFirmProfile } from '@/types/db';

// ---- Daily-loss boundary scenarios --------------------------------------

describe('computeDailyLossRoom — boundary buckets', () => {
  const limit = 1000;

  it('0% used: loss=0 → room=1000 usedPct=0', () => {
    const r = computeDailyLossRoom({ todayRealizedLoss: 0, dailyLossLimit: limit });
    expect(r.room).toBe(1000);
    expect(r.usedPct).toBe(0);
  });

  it('79% used: loss=790 → room=210 usedPct=0.79', () => {
    const r = computeDailyLossRoom({ todayRealizedLoss: 790, dailyLossLimit: limit });
    expect(r.room).toBe(210);
    expect(r.usedPct).toBeCloseTo(0.79, 10);
  });

  it('80% used: loss=800 → room=200 usedPct=0.80', () => {
    const r = computeDailyLossRoom({ todayRealizedLoss: 800, dailyLossLimit: limit });
    expect(r.room).toBe(200);
    expect(r.usedPct).toBeCloseTo(0.8, 10);
  });

  it('100% used: loss=1000 → room=0 usedPct=1.0', () => {
    const r = computeDailyLossRoom({ todayRealizedLoss: 1000, dailyLossLimit: limit });
    expect(r.room).toBe(0);
    expect(r.usedPct).toBe(1);
  });

  it('110% used (overshoot): loss=1100 → room=-100 usedPct=1.10', () => {
    const r = computeDailyLossRoom({ todayRealizedLoss: 1100, dailyLossLimit: limit });
    expect(r.room).toBe(-100);
    expect(r.usedPct).toBeCloseTo(1.1, 10);
  });
});

// ---- evaluateRoom warning threshold (SC-009) ----------------------------

function makeProfile(overrides: Partial<PropFirmProfile> = {}): PropFirmProfile {
  return {
    id: 'profile-1',
    owner_id: 'user-1',
    firm_name: 'topstep',
    firm_label: 'Topstep 50K',
    account_size: '50000',
    daily_loss_limit: '1000',
    drawdown_type: 'static',
    drawdown_limit: '2000',
    warn_threshold_pct: '0.80',
    is_active: true,
    created_at: '2026-05-23T00:00:00Z',
    ...overrides,
  };
}

describe('evaluateRoom — warningActive boundary (SC-009)', () => {
  const baseCtx = {
    eodBalances: [50000],
    currentEquity: 50000,
    equityCurveIntraday: [50000],
  };

  it('used=79% → warningActive=false', () => {
    const profile = makeProfile();
    const r = evaluateRoom(profile, { ...baseCtx, todayRealizedLoss: 790 });
    expect(r.dailyLossUsedPct).toBeCloseTo(0.79, 10);
    expect(r.warningActive).toBe(false);
  });

  it('used=80% (exact boundary) → warningActive=true (>= semantics)', () => {
    const profile = makeProfile();
    const r = evaluateRoom(profile, { ...baseCtx, todayRealizedLoss: 800 });
    expect(r.dailyLossUsedPct).toBeCloseTo(0.8, 10);
    expect(r.warningActive).toBe(true);
  });

  it('used=100% → warningActive=true', () => {
    const profile = makeProfile();
    const r = evaluateRoom(profile, { ...baseCtx, todayRealizedLoss: 1000 });
    expect(r.warningActive).toBe(true);
  });

  it('drawdown side: drawdownRoom <= (1-warn)*limit → warningActive=true', () => {
    // limit=2000, warn=0.80 → trigger when room/limit < 0.20, i.e. room < 400.
    // Set equity so drawdownRoom = 300 (static: 50000-2000 = 48000 floor → equity 48300).
    const profile = makeProfile({ drawdown_type: 'static' });
    const r = evaluateRoom(profile, {
      ...baseCtx,
      currentEquity: 48300,
      todayRealizedLoss: 0,
    });
    expect(r.drawdownRoom).toBe(300);
    expect(r.warningActive).toBe(true);
  });

  it('drawdown side: room=500 (room/limit=0.25 >= 0.20) → no warning', () => {
    const profile = makeProfile({ drawdown_type: 'static' });
    const r = evaluateRoom(profile, {
      ...baseCtx,
      currentEquity: 48500,
      todayRealizedLoss: 0,
    });
    expect(r.drawdownRoom).toBe(500);
    expect(r.warningActive).toBe(false);
  });

  it('custom warn=0.70: used=70% → warningActive=true', () => {
    const profile = makeProfile({ warn_threshold_pct: '0.70' });
    const r = evaluateRoom(profile, { ...baseCtx, todayRealizedLoss: 700 });
    expect(r.warningActive).toBe(true);
  });

  it('custom warn=0.70: used=69% → warningActive=false', () => {
    const profile = makeProfile({ warn_threshold_pct: '0.70' });
    const r = evaluateRoom(profile, { ...baseCtx, todayRealizedLoss: 690 });
    expect(r.warningActive).toBe(false);
  });

  it('null daily limit + safe drawdown → no warning', () => {
    const profile = makeProfile({ daily_loss_limit: null });
    const r = evaluateRoom(profile, { ...baseCtx, todayRealizedLoss: 9999 });
    expect(r.dailyLossUsedPct).toBeNull();
    expect(r.warningActive).toBe(false);
  });
});
