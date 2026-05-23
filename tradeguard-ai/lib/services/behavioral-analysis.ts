// Computes deterministic behavioral scores per trade.
// Each call APPENDS a fresh `analyses` row per spec (idempotent in value, not in row count).

import type { SupabaseClient } from '@supabase/supabase-js';
import type { Analysis, Trade, UUID } from '@/types/db';
import {
  computeOverconfidenceScore,
  computeRevengeScore,
  computeStopDelayScore,
} from '@/lib/scoring/behavioral';
import { getAllTradesForOwner, getTradesByIds } from '@/lib/repositories/trades';
import {
  getTradesWithoutAnalysis,
  insertAnalysisBatch,
  type NewAnalysisInput,
} from '@/lib/repositories/analyses';

const HOLDING_WINDOW_DAYS = 30;
const MS_PER_DAY = 86_400_000;

export interface RecomputeParams {
  supabase: SupabaseClient;
  ownerId: UUID;
  tradeIds?: UUID[] | null;
  scope?: 'all' | 'uncomputed';
}

export async function recomputeAnalysesForTrades(
  params: RecomputeParams,
): Promise<{ processed: number; analyses: Analysis[] }> {
  const { supabase, ownerId, tradeIds, scope } = params;

  let targets: Trade[];
  if (tradeIds && tradeIds.length > 0) {
    targets = await getTradesByIds(supabase, ownerId, tradeIds);
  } else if (scope === 'uncomputed') {
    targets = await getTradesWithoutAnalysis(supabase, ownerId);
  } else {
    targets = await getAllTradesForOwner(supabase, ownerId);
  }

  if (targets.length === 0) return { processed: 0, analyses: [] };

  // F7: Idempotency guard. The DB has no unique constraint on (trade_id) for
  // analyses (each call can persist a fresh snapshot per spec FR-018), but
  // re-running with scope=all on already-scored trades would silently double
  // up rows and skew profile aggregates. We dedupe targets against trades
  // that already have ANY analysis row — only "uncomputed" trades proceed.
  // Callers needing a forced re-score must pass explicit tradeIds, which
  // bypasses this gate intentionally.
  const isExplicitTradeIds = Array.isArray(tradeIds) && tradeIds.length > 0;
  if (!isExplicitTradeIds) {
    const uncomputed = await getTradesWithoutAnalysis(supabase, ownerId);
    const uncomputedIds = new Set(uncomputed.map((t) => t.id));
    targets = targets.filter((t) => uncomputedIds.has(t.id));
    if (targets.length === 0) return { processed: 0, analyses: [] };
  }

  // Full history powers context features (avg holding, prior streak, etc).
  // Reuse the `targets` query when scope=all and no explicit ids — same shape.
  const history = isExplicitTradeIds ? await getAllTradesForOwner(supabase, ownerId) : targets;
  const sortedHistory = [...history].sort((a, b) => a.entry_at.localeCompare(b.entry_at));

  const inputs: NewAnalysisInput[] = targets.map((trade) =>
    computeAnalysisForTrade(trade, sortedHistory),
  );
  const inserted = await insertAnalysisBatch(supabase, ownerId, inputs);
  return { processed: inserted.length, analyses: inserted };
}

function computeAnalysisForTrade(trade: Trade, history: Trade[]): NewAnalysisInput {
  const tradePnl = trade.pnl === null ? 0 : Number(trade.pnl);
  const tradeContracts = Number(trade.contracts);
  const holdingMin = holdingMinutes(trade);
  const avgHoldingMin = avgHoldingMinutes30d(history, trade);
  const medianContracts = medianContracts30d(history, trade);
  const { count: prevConsecutiveLossCount, prevLossExitAt } = priorLossStreakWithExit(
    history,
    trade,
  );
  const prevTrade = previousTrade(history, trade);
  const winStreak = priorWinStreak(history, trade);

  const stopDelay = computeStopDelayScore({
    holdingMinutes: holdingMin ?? 0,
    userAvgHoldingMinutes30d: avgHoldingMin ?? 0,
    pnl: tradePnl,
  });
  const revenge = computeRevengeScore({
    prevConsecutiveLossCount,
    gapMinutesSincePrevLoss:
      prevLossExitAt === null
        ? null
        : (new Date(trade.entry_at).getTime() - prevLossExitAt.getTime()) / 60_000,
  });
  const overconfidence = computeOverconfidenceScore({
    prevPnl: prevTrade?.pnl === undefined || prevTrade?.pnl === null ? null : Number(prevTrade.pnl),
    contracts: tradeContracts,
    userMedianContracts30d: medianContracts ?? 0,
    winStreak,
  });

  return {
    trade_id: trade.id,
    stop_delay_score: stopDelay,
    revenge_score: revenge,
    overconfidence_score: overconfidence,
    retrospective_status: 'pending',
  };
}

function holdingMinutes(t: Trade): number | null {
  if (t.exit_at === null) return null;
  return (new Date(t.exit_at).getTime() - new Date(t.entry_at).getTime()) / 60_000;
}

function avgHoldingMinutes30d(history: Trade[], target: Trade): number | null {
  const targetTs = new Date(target.entry_at).getTime();
  const windowStart = targetTs - HOLDING_WINDOW_DAYS * MS_PER_DAY;
  const samples: number[] = [];
  for (const t of history) {
    if (t.id === target.id) continue;
    if (t.exit_at === null) continue;
    const ts = new Date(t.entry_at).getTime();
    if (ts < windowStart || ts >= targetTs) continue;
    samples.push((new Date(t.exit_at).getTime() - new Date(t.entry_at).getTime()) / 60_000);
  }
  if (samples.length === 0) return null;
  return samples.reduce((s, x) => s + x, 0) / samples.length;
}

function medianContracts30d(history: Trade[], target: Trade): number | null {
  const targetTs = new Date(target.entry_at).getTime();
  const windowStart = targetTs - HOLDING_WINDOW_DAYS * MS_PER_DAY;
  const window = history
    .filter((t) => {
      if (t.id === target.id) return false;
      const ts = new Date(t.entry_at).getTime();
      return ts >= windowStart && ts < targetTs;
    })
    .map((t) => Number(t.contracts))
    .sort((a, b) => a - b);
  if (window.length === 0) return null;
  const mid = Math.floor(window.length / 2);
  return window.length % 2 === 0 ? (window[mid - 1] + window[mid]) / 2 : window[mid];
}

function priorLossStreakWithExit(
  history: Trade[],
  target: Trade,
): { count: number; prevLossExitAt: Date | null } {
  const targetTs = new Date(target.entry_at).getTime();
  const prior = history
    .filter(
      (t) => t.id !== target.id && new Date(t.entry_at).getTime() < targetTs && t.pnl !== null,
    )
    .sort((a, b) => b.entry_at.localeCompare(a.entry_at));
  let streak = 0;
  let mostRecentLossExit: Date | null = null;
  for (const t of prior) {
    const pnl = Number(t.pnl);
    if (pnl < 0) {
      streak++;
      if (mostRecentLossExit === null && t.exit_at !== null) {
        mostRecentLossExit = new Date(t.exit_at);
      }
    } else {
      break;
    }
  }
  return { count: streak, prevLossExitAt: mostRecentLossExit };
}

function priorWinStreak(history: Trade[], target: Trade): number {
  const targetTs = new Date(target.entry_at).getTime();
  const prior = history
    .filter(
      (t) => t.id !== target.id && new Date(t.entry_at).getTime() < targetTs && t.pnl !== null,
    )
    .sort((a, b) => b.entry_at.localeCompare(a.entry_at));
  let streak = 0;
  for (const t of prior) {
    const pnl = Number(t.pnl);
    if (pnl > 0) streak++;
    else break;
  }
  return streak;
}

function previousTrade(history: Trade[], target: Trade): Trade | null {
  const targetTs = new Date(target.entry_at).getTime();
  const prior = history
    .filter((t) => t.id !== target.id && new Date(t.entry_at).getTime() < targetTs)
    .sort((a, b) => b.entry_at.localeCompare(a.entry_at));
  return prior[0] ?? null;
}
