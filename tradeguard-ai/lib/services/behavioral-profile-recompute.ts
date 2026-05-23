// Recomputes the per-user behavioral profile aggregate.
// Triggered by:
//   1. POST /api/analysis  (sync after score recompute)
//   2. supabase/functions/recompute-profile  (queue worker, last_recomputed_at IS NULL)

import type { SupabaseClient } from '@supabase/supabase-js';
import type { Analysis, BehavioralProfile, UUID } from '@/types/db';
import { computeBehavioralProfile } from '@/lib/scoring/behavioral-aggregates';
import { getAllTradesForOwner } from '@/lib/repositories/trades';
import { upsertBehavioralProfile } from '@/lib/repositories/analyses';

export interface RecomputeProfileParams {
  supabase: SupabaseClient;
  ownerId: UUID;
}

export async function recomputeBehavioralProfile(
  params: RecomputeProfileParams,
): Promise<BehavioralProfile> {
  const { supabase, ownerId } = params;

  const trades = await getAllTradesForOwner(supabase, ownerId);
  const analyses = await loadLatestAnalysesByTrade(supabase, ownerId);

  const aggregate = computeBehavioralProfile(
    trades,
    analyses.map((a) => ({
      trade_id: a.trade_id,
      stop_delay_score: a.stop_delay_score,
      revenge_score: a.revenge_score,
      overconfidence_score: a.overconfidence_score,
    })),
  );

  // After the F9 fix, aggregate fields are nullable when the user has no
  // closed trades / scored analyses yet. Preserve the nullness through to
  // the DB (NUMERIC columns are nullable) instead of coercing to '0' which
  // would lie about the data state. The repo accepts string | null per row.
  return upsertBehavioralProfile(supabase, ownerId, {
    avg_stop_delay_score:
      aggregate.avgStopDelayScore === null ? null : aggregate.avgStopDelayScore.toFixed(2),
    avg_revenge_trade_gap_minutes:
      aggregate.avgRevengeTradeGapMinutes === null
        ? null
        : aggregate.avgRevengeTradeGapMinutes.toFixed(2),
    max_loss_streak: aggregate.maxLossStreak,
    night_trading_ratio:
      aggregate.nightTradingRatio === null ? null : aggregate.nightTradingRatio.toFixed(3),
    overconfidence_score:
      aggregate.overconfidenceScore === null ? null : aggregate.overconfidenceScore.toFixed(2),
    total_trades: aggregate.totalTrades,
    last_recomputed_at: new Date().toISOString(),
  });
}

async function loadLatestAnalysesByTrade(
  supabase: SupabaseClient,
  ownerId: UUID,
): Promise<Analysis[]> {
  const { data, error } = await supabase
    .from('analyses')
    .select('*')
    .eq('owner_id', ownerId)
    .order('created_at', { ascending: false });
  if (error) throw error;
  const seen = new Set<UUID>();
  const latest: Analysis[] = [];
  for (const a of (data ?? []) as Analysis[]) {
    if (seen.has(a.trade_id)) continue;
    seen.add(a.trade_id);
    latest.push(a);
  }
  return latest;
}
