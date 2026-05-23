// LLM cost guard — circuit breaker that blocks LLM calls when the user's
// daily spend exceeds `LLM_DAILY_USD_CAP` (env var, default $5). Reads from
// the `llm_daily_spend` view (migration 0013) so the check is one query.
//
// Behavior:
//   - Below cap            → returns { allowed: true, ... }
//   - At/above cap         → returns { allowed: false, ... } → caller returns 429
//   - View read fails      → returns { allowed: true, soft: true } and logs.
//     We "fail open" because the guard is a soft cost rail, not a security
//     boundary. The user is single-tenant; a misbehaving DB shouldn't lock
//     them out of their own product mid-analysis.

import type { SupabaseClient } from '@supabase/supabase-js';
import { logger } from '@/lib/utils/logger';

const DEFAULT_CAP_USD = 5.0;
const RESET_HINT_SECONDS = 60 * 60; // suggest 1h retry — caps reset at UTC midnight

export interface CostGuardVerdict {
  allowed: boolean;
  spentTodayUsd: number;
  capUsd: number;
  /** When `allowed=false`, hint to caller for `Retry-After`. */
  retryAfterSeconds?: number;
  /** True when the view query failed and we failed open. */
  soft?: boolean;
}

export interface CostGuardOptions {
  /** Override `LLM_DAILY_USD_CAP` env var. */
  capUsd?: number;
}

function resolveCap(opts: CostGuardOptions): number {
  if (opts.capUsd !== undefined) return opts.capUsd;
  const raw = process.env.LLM_DAILY_USD_CAP;
  if (!raw) return DEFAULT_CAP_USD;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : DEFAULT_CAP_USD;
}

/**
 * Check whether the user is under their daily LLM spend cap.
 * Today's date is computed in UTC to match the view's `date_trunc('day')`.
 */
export async function checkCostGuard(
  supabase: SupabaseClient,
  ownerId: string,
  opts: CostGuardOptions = {},
): Promise<CostGuardVerdict> {
  const capUsd = resolveCap(opts);
  // Cap of 0 disables the guard (legitimate dev override).
  if (capUsd === 0) {
    return { allowed: true, spentTodayUsd: 0, capUsd: 0 };
  }

  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);
  const todayIso = today.toISOString();

  try {
    const { data, error } = await supabase
      .from('llm_daily_spend')
      .select('total_cost_usd')
      .eq('owner_id', ownerId)
      .gte('spend_date', todayIso)
      .maybeSingle();

    if (error) {
      logger.warn('cost_guard_query_failed', { message: error.message });
      return { allowed: true, spentTodayUsd: 0, capUsd, soft: true };
    }

    const spent = data ? Number(data.total_cost_usd) : 0;
    const allowed = spent < capUsd;
    return {
      allowed,
      spentTodayUsd: spent,
      capUsd,
      ...(allowed ? {} : { retryAfterSeconds: RESET_HINT_SECONDS }),
    };
  } catch (err) {
    logger.warn('cost_guard_unexpected', {
      message: err instanceof Error ? err.message : String(err),
    });
    return { allowed: true, spentTodayUsd: 0, capUsd, soft: true };
  }
}
