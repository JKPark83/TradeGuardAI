// Repository for `trading_sessions` (+ related read joins for history page).
// All functions accept a Supabase client created in the caller (RSC, Route
// Handler) — never reads auth context itself. owner_id is always passed
// explicitly to keep authorization decisions at the route boundary.
//
// Domain rule: a user has at most one active session (ended_at IS NULL) at a
// time. The active-session lookup orders by started_at DESC LIMIT 1 so even
// if invariant ever breaks, we surface the most recent one.

import type { SupabaseClient } from '@supabase/supabase-js';
import type { TiltCheck, TradingSession, UUID } from '@/types/db';

export interface ListSessionsParams {
  /** Inclusive ISO 8601 lower bound on `started_at`. */
  from?: string;
  /** Inclusive ISO 8601 upper bound on `started_at`. */
  to?: string;
  limit?: number;
}

export interface SessionTradesSummary {
  tradeCount: number;
  totalPnL: number;
}

export interface TradingSessionWithSummary extends TradingSession {
  tilt_color: TiltCheck['tilt_color'] | null;
  trade_count: number;
  total_pnl: number;
}

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 500;

function clampLimit(limit: number | undefined): number {
  if (limit === undefined) return DEFAULT_LIMIT;
  if (limit <= 0) return DEFAULT_LIMIT;
  return Math.min(limit, MAX_LIMIT);
}

/**
 * Find the currently active session for an owner, if any.
 * Returns the most recently started open session (ended_at IS NULL).
 */
export async function findActiveSession(
  supabase: SupabaseClient,
  ownerId: UUID,
): Promise<TradingSession | null> {
  const { data, error } = await supabase
    .from('trading_sessions')
    .select('*')
    .eq('owner_id', ownerId)
    .is('ended_at', null)
    .order('started_at', { ascending: false })
    .limit(1)
    .maybeSingle<TradingSession>();
  if (error) throw error;
  return data;
}

/** Insert a new active session (started_at defaults to now() via DB). */
export async function createSession(
  supabase: SupabaseClient,
  ownerId: UUID,
): Promise<TradingSession> {
  const { data, error } = await supabase
    .from('trading_sessions')
    .insert({ owner_id: ownerId, started_at: new Date().toISOString() })
    .select('*')
    .single<TradingSession>();
  if (error) throw error;
  return data;
}

/**
 * Close a session by stamping ended_at = now(). Scoped by both id and
 * owner_id so a stale session id from another user is a no-op (defense-in-
 * depth alongside RLS).
 */
export async function endSession(
  supabase: SupabaseClient,
  ownerId: UUID,
  sessionId: UUID,
): Promise<TradingSession> {
  const { data, error } = await supabase
    .from('trading_sessions')
    .update({ ended_at: new Date().toISOString() })
    .eq('owner_id', ownerId)
    .eq('id', sessionId)
    .select('*')
    .single<TradingSession>();
  if (error) throw error;
  return data;
}

/**
 * Session history for the `/api/sessions/history` endpoint. Decorates each
 * row with the session's tilt color + aggregated trade count / PnL.
 *
 * Implementation: pull sessions in one query, then fan out tilt_checks +
 * trades lookups in parallel. N is small (single-user tool, sessions per
 * day are at most a handful), so in-memory join is fine.
 */
export async function listSessions(
  supabase: SupabaseClient,
  ownerId: UUID,
  params: ListSessionsParams,
): Promise<TradingSessionWithSummary[]> {
  const limit = clampLimit(params.limit);
  let query = supabase
    .from('trading_sessions')
    .select('*')
    .eq('owner_id', ownerId)
    .order('started_at', { ascending: false })
    .limit(limit);
  if (params.from) query = query.gte('started_at', params.from);
  if (params.to) query = query.lte('started_at', params.to);

  const { data, error } = await query;
  if (error) throw error;
  const sessions = (data ?? []) as TradingSession[];
  if (sessions.length === 0) return [];

  const sessionIds = sessions.map((s) => s.id);

  const [tiltsRes, tradesRes] = await Promise.all([
    supabase.from('tilt_checks').select('session_id, tilt_color').in('session_id', sessionIds),
    supabase
      .from('trades')
      .select('session_id, pnl')
      .eq('owner_id', ownerId)
      .in('session_id', sessionIds),
  ]);
  if (tiltsRes.error) throw tiltsRes.error;
  if (tradesRes.error) throw tradesRes.error;

  const tiltBySession = new Map<UUID, TiltCheck['tilt_color']>();
  for (const t of (tiltsRes.data ?? []) as {
    session_id: UUID;
    tilt_color: TiltCheck['tilt_color'];
  }[]) {
    tiltBySession.set(t.session_id, t.tilt_color);
  }

  const summaryBySession = new Map<UUID, SessionTradesSummary>();
  for (const t of (tradesRes.data ?? []) as { session_id: UUID | null; pnl: string | null }[]) {
    if (!t.session_id) continue;
    const cur = summaryBySession.get(t.session_id) ?? { tradeCount: 0, totalPnL: 0 };
    cur.tradeCount += 1;
    if (t.pnl !== null) cur.totalPnL += Number(t.pnl);
    summaryBySession.set(t.session_id, cur);
  }

  return sessions.map((s) => {
    const sum = summaryBySession.get(s.id) ?? { tradeCount: 0, totalPnL: 0 };
    return {
      ...s,
      tilt_color: tiltBySession.get(s.id) ?? null,
      trade_count: sum.tradeCount,
      total_pnl: Number(sum.totalPnL.toFixed(2)),
    };
  });
}

/**
 * Aggregate trade count + total realized PnL for a single session. Used by
 * `PATCH /api/sessions/:id/end` to report `tradesInSession` in the response.
 *
 * Note: `trades.session_id` is nullable (CSV uploads predate sessions), but
 * the filter on `eq('session_id', sessionId)` already excludes nulls.
 */
export async function getSessionTradesSummary(
  supabase: SupabaseClient,
  ownerId: UUID,
  sessionId: UUID,
): Promise<SessionTradesSummary> {
  const { data, error } = await supabase
    .from('trades')
    .select('pnl')
    .eq('owner_id', ownerId)
    .eq('session_id', sessionId);
  if (error) throw error;
  const rows = (data ?? []) as { pnl: string | null }[];
  let totalPnL = 0;
  for (const r of rows) {
    if (r.pnl !== null) totalPnL += Number(r.pnl);
  }
  return { tradeCount: rows.length, totalPnL: Number(totalPnL.toFixed(2)) };
}
