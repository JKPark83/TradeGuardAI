// Deterministic prop-firm drawdown + daily-loss room calculators.
//
// Contract: pure (no Date.now, no Math.random, no I/O). Same input → same output.
// Formulas are transcribed verbatim from research.md §R-08.
// Numeric inputs are plain JS numbers; callers must normalize NUMERIC strings
// (DB representation) at the repository boundary.

import type { PropFirmProfile } from '@/types/db';
import type { PropFirmCurrentRoom } from '@/types/api';

// ---- Static drawdown ---------------------------------------------------

export interface StaticDrawdownArgs {
  accountSize: number;
  drawdownLimit: number;
  currentEquity: number;
}

export interface DrawdownResult {
  floor: number;
  room: number;
  breach: boolean;
}

/** floor = accountSize - drawdownLimit; breach when currentEquity < floor. */
export function computeStaticDrawdown(args: StaticDrawdownArgs): DrawdownResult {
  const floor = args.accountSize - args.drawdownLimit;
  const room = args.currentEquity - floor;
  return { floor, room, breach: args.currentEquity < floor };
}

// ---- EOD trailing drawdown --------------------------------------------

export interface EodTrailingArgs {
  /** EOD balance history (chronological order). May be empty. */
  eodBalanceHistory: number[];
  drawdownLimit: number;
  currentEquity: number;
}

/**
 * EOD Trailing: floor = max(eodBalanceHistory) - drawdownLimit.
 *
 * Degenerate case: empty history → anchor on currentEquity so brand-new
 * accounts report room = drawdownLimit (no breach until first EOD posts).
 */
export function computeEodTrailingDrawdown(args: EodTrailingArgs): DrawdownResult {
  const peak =
    args.eodBalanceHistory.length === 0 ? args.currentEquity : Math.max(...args.eodBalanceHistory);
  const floor = peak - args.drawdownLimit;
  const room = args.currentEquity - floor;
  return { floor, room, breach: args.currentEquity < floor };
}

// ---- Intraday trailing drawdown ---------------------------------------

export interface IntradayTrailingArgs {
  /** Intraday equity curve (chronological order). May be empty. */
  equityCurve: number[];
  drawdownLimit: number;
  currentEquity: number;
}

/**
 * Intraday Trailing: floor = max(equityCurve) - drawdownLimit. The peak
 * resets per session per most prop firms; we treat the supplied curve as
 * already scoped to the relevant window.
 */
export function computeIntradayTrailingDrawdown(args: IntradayTrailingArgs): DrawdownResult {
  const peak = args.equityCurve.length === 0 ? args.currentEquity : Math.max(...args.equityCurve);
  const floor = peak - args.drawdownLimit;
  const room = args.currentEquity - floor;
  return { floor, room, breach: args.currentEquity < floor };
}

// ---- Daily loss room --------------------------------------------------

export interface DailyLossArgs {
  /** Today's realized loss as a POSITIVE number. 0 if no loss yet. */
  todayRealizedLoss: number;
  /** null when the prop firm has no daily-loss rule (e.g. some FTMO challenges). */
  dailyLossLimit: number | null;
}

export interface DailyLossResult {
  room: number | null;
  usedPct: number | null;
}

/**
 * dailyLossRoom = dailyLossLimit - todayRealizedLoss (room never goes below 0
 * in the response; that signals "fully consumed / breached").
 * Returns {null, null} when dailyLossLimit is null.
 */
export function computeDailyLossRoom(args: DailyLossArgs): DailyLossResult {
  if (args.dailyLossLimit === null) return { room: null, usedPct: null };
  if (args.dailyLossLimit <= 0) {
    // Defensive: a zero/negative limit is meaningless. Treat as no rule.
    return { room: null, usedPct: null };
  }
  const loss = Math.max(0, args.todayRealizedLoss);
  const room = args.dailyLossLimit - loss;
  const usedPct = loss / args.dailyLossLimit;
  return { room, usedPct };
}

// ---- Orchestrator -----------------------------------------------------

export interface EvaluateRoomCtx {
  /** EOD balance history (chronological). Used for `eod_trailing`. */
  eodBalances: number[];
  /** Live equity. Required for all drawdown calculators. */
  currentEquity: number;
  /** Today's realized loss as a POSITIVE number. */
  todayRealizedLoss: number;
  /** Intraday equity curve. Used for `intraday_trailing`. */
  equityCurveIntraday: number[];
}

/**
 * Pick the right drawdown calculator based on `profile.drawdown_type` and
 * fuse with daily-loss-room into the API-shaped `PropFirmCurrentRoom`.
 *
 * `warningActive` mirrors contracts/prop-firm-api.md:
 *   - dailyLossUsedPct >= warnThresholdPct, OR
 *   - drawdownRoom / drawdownLimit < (1 - warnThresholdPct)
 */
export function evaluateRoom(profile: PropFirmProfile, ctx: EvaluateRoomCtx): PropFirmCurrentRoom {
  const accountSize = Number(profile.account_size);
  const drawdownLimit = Number(profile.drawdown_limit);
  const dailyLossLimit =
    profile.daily_loss_limit === null ? null : Number(profile.daily_loss_limit);
  const warnThresholdPct = Number(profile.warn_threshold_pct);

  let dd: DrawdownResult;
  switch (profile.drawdown_type) {
    case 'static':
      dd = computeStaticDrawdown({
        accountSize,
        drawdownLimit,
        currentEquity: ctx.currentEquity,
      });
      break;
    case 'eod_trailing':
      dd = computeEodTrailingDrawdown({
        eodBalanceHistory: ctx.eodBalances,
        drawdownLimit,
        currentEquity: ctx.currentEquity,
      });
      break;
    case 'intraday_trailing':
      dd = computeIntradayTrailingDrawdown({
        equityCurve: ctx.equityCurveIntraday,
        drawdownLimit,
        currentEquity: ctx.currentEquity,
      });
      break;
  }

  const daily = computeDailyLossRoom({
    todayRealizedLoss: ctx.todayRealizedLoss,
    dailyLossLimit,
  });

  const dailyWarn = daily.usedPct !== null && daily.usedPct >= warnThresholdPct;
  // drawdown side: warn when remaining room is <= (1 - warn) * drawdownLimit.
  // Equivalent to "used >= warn * drawdownLimit" but stated as room.
  const drawdownWarn = drawdownLimit > 0 && dd.room / drawdownLimit < 1 - warnThresholdPct;

  return {
    dailyLossRoom: daily.room,
    dailyLossUsedPct: daily.usedPct,
    drawdownRoom: dd.room,
    drawdownFloor: dd.floor,
    currentEquity: ctx.currentEquity,
    warningActive: dailyWarn || drawdownWarn,
  };
}
