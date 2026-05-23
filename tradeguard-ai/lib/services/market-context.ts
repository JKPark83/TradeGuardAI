/**
 * Market-context backfill service (US3, FR-009/010/011).
 *
 * Walks the target trades sequentially (rate-limited at the adapter layer)
 * and for each one:
 *   1. Calls Yahoo for { vix, dxy, volume, atr14 } at `entry_at`
 *   2. Calls Finnhub for events in [entry_at - 6h, entry_at + 6h]
 *   3. Picks the nearest event (by absolute minute offset) or marks 'normal'
 *   4. Upserts the snapshot row, deriving `data_source` from which sources
 *      actually returned data (yahoo-only, finnhub-only, or mixed).
 *
 * Edge-case taxonomy:
 *   - `filled`         — snapshot row written (data may be partial)
 *   - `skippedNoData`  — both adapters returned null/[] → no row written
 *                        (matches FR-010: leave context empty for retry)
 *   - `failed`         — DB write threw (RLS error, conflict, …)
 *
 * Job tracking lives in an in-process Map (`jobStore`) — sufficient for the
 * single-user runtime. When we go multi-instance, swap this for Redis. The
 * route handlers (`POST /api/market-context/fill`,
 * `GET /api/market-context/fill/:jobId`) read from this exported map.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import type { EventType, MarketDataSource, Trade, UUID } from '@/types/db';
import { logger } from '@/lib/utils/logger';
import { getTradesByIds, getAllTradesForOwner } from '@/lib/repositories/trades';
import {
  listMissingTradeIds,
  upsertSnapshot,
  type NewMarketSnapshot,
} from '@/lib/repositories/market-snapshots';
import { fetchSnapshot, type YahooSnapshot } from '@/lib/market/yahoo';
import { fetchEconomicCalendar, type EconomicEvent } from '@/lib/market/finnhub';

const EVENT_WINDOW_MS = 6 * 60 * 60 * 1000;

export type JobStatus = 'queued' | 'running' | 'completed' | 'failed';

export interface JobState {
  jobId: UUID;
  ownerId: UUID;
  status: JobStatus;
  filled: number;
  skippedNoData: number;
  failed: number;
  total: number;
  startedAt: string;
  completedAt: string | null;
}

export const jobStore = new Map<UUID, JobState>();

export interface BackfillParams {
  supabase: SupabaseClient;
  ownerId: UUID;
  tradeIds?: UUID[];
  scope?: 'missing_only' | 'all';
}

export interface BackfillResult {
  filled: number;
  skippedNoData: number;
  failed: number;
}

/**
 * Resolve which trades to process based on `scope` and `tradeIds`:
 *   - scope='missing_only' + ids   → ids ∩ trades-without-snapshot
 *   - scope='missing_only' (no ids) → all owner trades without snapshot
 *   - scope='all' + ids            → exactly those ids
 *   - scope='all' (no ids)         → all owner trades
 *   - default (no scope)           → 'missing_only'
 */
async function resolveTargets(args: BackfillParams): Promise<Trade[]> {
  const { supabase, ownerId, tradeIds, scope = 'missing_only' } = args;

  if (scope === 'all') {
    if (tradeIds && tradeIds.length > 0) {
      return getTradesByIds(supabase, ownerId, tradeIds);
    }
    return getAllTradesForOwner(supabase, ownerId);
  }

  const missing = await listMissingTradeIds(supabase, ownerId, tradeIds);
  if (missing.length === 0) return [];
  return getTradesByIds(supabase, ownerId, missing);
}

/**
 * Pick the nearest event to `at` within ±EVENT_WINDOW_MS. Returns null when
 * no event is in the window — the caller marks the snapshot as 'normal'.
 */
function pickNearestEvent(
  events: EconomicEvent[],
  at: Date,
): { event: EconomicEvent; offsetMinutes: number } | null {
  let best: { event: EconomicEvent; offsetMinutes: number } | null = null;
  for (const ev of events) {
    const evMs = new Date(ev.scheduledAt).getTime();
    const deltaMs = evMs - at.getTime();
    if (Math.abs(deltaMs) > EVENT_WINDOW_MS) continue;
    const offsetMinutes = Math.trunc(deltaMs / 60_000);
    if (!best || Math.abs(offsetMinutes) < Math.abs(best.offsetMinutes)) {
      best = { event: ev, offsetMinutes };
    }
  }
  return best;
}

function deriveDataSource(
  yahoo: YahooSnapshot | null,
  haveFinnhub: boolean,
): MarketDataSource | null {
  const yahooHas =
    yahoo !== null &&
    (yahoo.vix !== null || yahoo.dxy !== null || yahoo.volume !== null || yahoo.atr14 !== null);
  if (yahooHas && haveFinnhub) return 'mixed';
  if (yahooHas) return 'yahoo';
  if (haveFinnhub) return 'finnhub';
  return null;
}

function numberToDecimalString(value: number | null): string | null {
  if (value === null) return null;
  return value.toString();
}

function bigIntegerToString(value: number | null): string | null {
  if (value === null) return null;
  return Math.trunc(value).toString();
}

/**
 * Backfill snapshots for the requested trades. Used both directly by the
 * synchronous test path and indirectly by `runBackfillJob` (fire-and-forget).
 */
export async function backfillMarketContext(params: BackfillParams): Promise<BackfillResult> {
  const targets = await resolveTargets(params);
  const result: BackfillResult = { filled: 0, skippedNoData: 0, failed: 0 };

  for (const trade of targets) {
    const entryAt = new Date(trade.entry_at);
    const eventFrom = new Date(entryAt.getTime() - EVENT_WINDOW_MS);
    const eventTo = new Date(entryAt.getTime() + EVENT_WINDOW_MS);

    const [yahoo, events] = await Promise.all([
      fetchSnapshot(trade.symbol, entryAt),
      fetchEconomicCalendar(eventFrom, eventTo),
    ]);

    const nearest = pickNearestEvent(events, entryAt);
    const haveFinnhub = events.length > 0;
    const source = deriveDataSource(yahoo, haveFinnhub);

    if (source === null) {
      result.skippedNoData += 1;
      continue;
    }

    const eventType: EventType | null = nearest
      ? nearest.event.type
      : haveFinnhub
        ? 'normal'
        : null;
    const offset: number | null = nearest ? nearest.offsetMinutes : null;

    const snapshot: NewMarketSnapshot = {
      trade_id: trade.id,
      symbol: trade.symbol,
      snapshot_at: trade.entry_at,
      vix: numberToDecimalString(yahoo?.vix ?? null),
      dxy: numberToDecimalString(yahoo?.dxy ?? null),
      volume: bigIntegerToString(yahoo?.volume ?? null),
      atr_14: numberToDecimalString(yahoo?.atr14 ?? null),
      event_type: eventType,
      event_offset_minutes: offset,
      data_source: source,
    };

    try {
      await upsertSnapshot(params.supabase, params.ownerId, snapshot);
      result.filled += 1;
    } catch (err) {
      logger.warn('market_snapshot_upsert_failed', {
        ownerId: params.ownerId,
        tradeId: trade.id,
        message: err instanceof Error ? err.message : String(err),
      });
      result.failed += 1;
    }
  }

  return result;
}

/**
 * Start a fire-and-forget backfill job. Returns the freshly-registered
 * `JobState` immediately so the POST handler can respond 202 with the id.
 */
export function startBackfillJob(args: {
  supabase: SupabaseClient;
  ownerId: UUID;
  tradeIds?: UUID[];
  scope?: 'missing_only' | 'all';
  estimatedTotal: number;
}): JobState {
  const jobId = crypto.randomUUID();
  const state: JobState = {
    jobId,
    ownerId: args.ownerId,
    status: 'queued',
    filled: 0,
    skippedNoData: 0,
    failed: 0,
    total: args.estimatedTotal,
    startedAt: new Date().toISOString(),
    completedAt: null,
  };
  jobStore.set(jobId, state);

  // Fire and forget — the Promise is intentionally unawaited.
  void (async () => {
    state.status = 'running';
    try {
      const r = await backfillMarketContext({
        supabase: args.supabase,
        ownerId: args.ownerId,
        tradeIds: args.tradeIds,
        scope: args.scope,
      });
      state.filled = r.filled;
      state.skippedNoData = r.skippedNoData;
      state.failed = r.failed;
      state.status = 'completed';
      state.completedAt = new Date().toISOString();
    } catch (err) {
      logger.error('backfill_job_failed', {
        jobId,
        ownerId: args.ownerId,
        message: err instanceof Error ? err.message : String(err),
      });
      state.status = 'failed';
      state.completedAt = new Date().toISOString();
    }
  })();

  return state;
}

export function getJobState(jobId: UUID): JobState | null {
  return jobStore.get(jobId) ?? null;
}
