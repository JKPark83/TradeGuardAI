// GET /api/analysis/profile — behavioral profile aggregate (FR-006).
// `minimumTradesReached` gates the "분석 부족" UX state.

import { createClient } from '@/lib/supabase/server';
import { toApiResponse, unauthenticated } from '@/lib/utils/api-error';
import { withRequestId } from '@/lib/utils/logger';
import { getProfileAggregates } from '@/lib/repositories/analyses';
import type { BehavioralProfileResponse } from '@/types/api';

const MIN_TRADES_FOR_PROFILE = 20;

export const runtime = 'nodejs';

export async function GET(): Promise<Response> {
  const requestId = crypto.randomUUID();
  const log = withRequestId(requestId);
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return unauthenticated();

    const profile = await getProfileAggregates(supabase, user.id);
    const body: BehavioralProfileResponse = profile
      ? {
          totalTrades: profile.total_trades,
          avgStopDelayScore:
            profile.avg_stop_delay_score === null ? 0 : Number(profile.avg_stop_delay_score),
          avgRevengeTradeGapMinutes:
            profile.avg_revenge_trade_gap_minutes === null
              ? 0
              : Number(profile.avg_revenge_trade_gap_minutes),
          maxLossStreak: profile.max_loss_streak,
          nightTradingRatio:
            profile.night_trading_ratio === null ? 0 : Number(profile.night_trading_ratio),
          overconfidenceScore:
            profile.overconfidence_score === null ? 0 : Number(profile.overconfidence_score),
          lastRecomputedAt: profile.last_recomputed_at ?? new Date(0).toISOString(),
          minimumTradesReached: profile.total_trades >= MIN_TRADES_FOR_PROFILE,
        }
      : {
          totalTrades: 0,
          avgStopDelayScore: 0,
          avgRevengeTradeGapMinutes: 0,
          maxLossStreak: 0,
          nightTradingRatio: 0,
          overconfidenceScore: 0,
          lastRecomputedAt: new Date(0).toISOString(),
          minimumTradesReached: false,
        };
    log.info('profile_fetched', { totalTrades: body.totalTrades });
    return new Response(JSON.stringify(body), {
      status: 200,
      headers: { 'Content-Type': 'application/json; charset=utf-8' },
    });
  } catch (err) {
    log.error('profile_fetch_failed', {
      message: err instanceof Error ? err.message : String(err),
    });
    return toApiResponse(err, requestId);
  }
}
