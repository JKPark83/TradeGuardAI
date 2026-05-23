// Per-user behavioral aggregates — computes the `behavioral_profiles` row.
//
// Pure: takes already-loaded trades + analyses, returns the aggregate fields.
// Caller (recompute job) is responsible for fetching and persisting.
// Aligned with `BehavioralProfile` in types/db.ts and the API shape in
// `BehavioralProfileResponse` in types/api.ts (camelCase for the response).

import type { Analysis, Trade } from '@/types/db';
import { hourOfDayUtc, minutesBetween } from '@/lib/utils/time';

/**
 * Minimal projection of `Analysis` used by aggregation. Pass only what's
 * needed so callers can join from any storage layer without coupling to
 * the full row.
 */
export interface AnalysesSummary {
  trade_id: string;
  stop_delay_score: number | null;
  revenge_score: number | null;
  overconfidence_score: number | null;
}

export interface BehavioralProfileFields {
  /** Null when no scored analyses exist yet. */
  avgStopDelayScore: number | null;
  /** Null when no consecutive-loss-gap pairs exist yet. */
  avgRevengeTradeGapMinutes: number | null;
  maxLossStreak: number;
  /** Fraction in [0,1] of closed trades whose entry hour UTC is in [22,24) ∪ [0,6). Null on empty input. */
  nightTradingRatio: number | null;
  /** Null when no scored analyses exist yet. */
  overconfidenceScore: number | null;
  totalTrades: number;
}

/** Mean of `nums`. Returns null when no values to avoid 0/null ambiguity in the UI. */
function meanOrNull(nums: number[]): number | null {
  if (nums.length === 0) return null;
  const sum = nums.reduce((a, b) => a + b, 0);
  return sum / nums.length;
}

function toNumberOrNull(s: string | null): number | null {
  if (s === null) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

/** 22:00..05:59 UTC inclusive — night trading band per spec. */
function isNightHourUtc(hour: number): boolean {
  return hour >= 22 || hour < 6;
}

/**
 * Compute per-user aggregates. Trades are expected pre-filtered to one owner.
 * Order-independent: function sorts by entry_at internally for streak/gap math.
 */
export function computeBehavioralProfile(
  trades: Trade[],
  scoredAnalyses: AnalysesSummary[],
): BehavioralProfileFields {
  const totalTrades = trades.length;
  if (totalTrades === 0) {
    return {
      avgStopDelayScore: null,
      avgRevengeTradeGapMinutes: null,
      maxLossStreak: 0,
      nightTradingRatio: null,
      overconfidenceScore: null,
      totalTrades: 0,
    };
  }

  // Sort chronologically by entry_at. Deterministic tie-break on id.
  const sortedTrades: Trade[] = [...trades].sort((a, b) => {
    if (a.entry_at === b.entry_at) return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
    return a.entry_at < b.entry_at ? -1 : 1;
  });

  // Latest analysis per trade — assume `scoredAnalyses` is already deduped to
  // one row per trade (callers pass `latest` view). If duplicates appear we
  // keep the first occurrence for determinism.
  const latestByTrade = new Map<string, AnalysesSummary>();
  for (const a of scoredAnalyses) {
    if (!latestByTrade.has(a.trade_id)) latestByTrade.set(a.trade_id, a);
  }

  // ---- avg stop-delay & overall overconfidence (mean of non-null per trade)
  const stopDelayVals: number[] = [];
  const overconfidenceVals: number[] = [];
  for (const t of sortedTrades) {
    const a = latestByTrade.get(t.id);
    if (!a) continue;
    if (a.stop_delay_score !== null) stopDelayVals.push(a.stop_delay_score);
    if (a.overconfidence_score !== null) overconfidenceVals.push(a.overconfidence_score);
  }

  // ---- max consecutive loss streak (closed trades with pnl < 0)
  let curStreak = 0;
  let maxLossStreak = 0;
  for (const t of sortedTrades) {
    const pnl = toNumberOrNull(t.pnl);
    if (pnl === null) {
      // Open or unreconciled trades don't break the streak — skip.
      continue;
    }
    if (pnl < 0) {
      curStreak += 1;
      if (curStreak > maxLossStreak) maxLossStreak = curStreak;
    } else {
      curStreak = 0;
    }
  }

  // ---- avg revenge trade gap minutes: time from each closed-loss exit to the
  // *immediately next* trade entry. Only the next single trade after a loss
  // counts (revenge-trade window). After consuming the gap we clear the
  // pointer — chains of losses each contribute their own one-step gap.
  const revengeGaps: number[] = [];
  let prevLossExit: Date | null = null;
  for (const t of sortedTrades) {
    if (prevLossExit !== null) {
      revengeGaps.push(minutesBetween(prevLossExit, new Date(t.entry_at)));
      prevLossExit = null;
    }
    const pnl = toNumberOrNull(t.pnl);
    if (pnl !== null && pnl < 0 && t.exit_at !== null) {
      prevLossExit = new Date(t.exit_at);
    }
  }

  // ---- night trading ratio (22:00..05:59 UTC at entry)
  let nightCount = 0;
  for (const t of sortedTrades) {
    if (isNightHourUtc(hourOfDayUtc(t.entry_at))) nightCount += 1;
  }
  const nightTradingRatio = nightCount / sortedTrades.length;

  return {
    avgStopDelayScore: meanOrNull(stopDelayVals),
    avgRevengeTradeGapMinutes: meanOrNull(revengeGaps),
    maxLossStreak,
    nightTradingRatio,
    overconfidenceScore: meanOrNull(overconfidenceVals),
    totalTrades,
  };
}

/** Re-export the projection type for callers that adapt from full `Analysis`. */
export type { Analysis };
