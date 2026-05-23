// Service: compute live `PropFirmCurrentRoom` for one or all of a user's
// active prop-firm profiles.
//
// Inputs that drive the room calculation:
//   - profile rules (account_size, drawdown_type, drawdown_limit, etc.)
//   - today's realized loss (sum of negative pnl from `trades` with exit_at
//     in [todayStartUtc, now))
//   - EOD balance history (from `prop_firm_eod_balances`, fed by edge fn)
//   - current equity (accountSize + cumulative realized PnL)
//
// Intraday equity curve is NOT persisted per-tick in v1 — we synthesize a
// single point from currentEquity so `intraday_trailing` degrades to "since
// last cron tick" semantics. Documented as a v1 limitation (see edge fn).

import type { SupabaseClient } from '@supabase/supabase-js';
import type { PropFirmProfile, UUID } from '@/types/db';
import type { PropFirmCurrentRoom, PropFirmProfileResponse } from '@/types/api';
import { evaluateRoom } from '@/lib/scoring/prop-firm';
import { listProfiles } from '@/lib/repositories/prop-firm';

interface TodayContext {
  todayRealizedLoss: number;
  cumulativeRealizedPnl: number;
  eodBalances: number[];
}

function startOfUtcDayIso(now: Date): string {
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  return d.toISOString();
}

async function loadCumulativePnl(supabase: SupabaseClient, ownerId: UUID): Promise<number> {
  const { data, error } = await supabase
    .from('trades')
    .select('pnl')
    .eq('owner_id', ownerId)
    .not('pnl', 'is', null);
  if (error) throw error;
  let total = 0;
  for (const row of (data ?? []) as { pnl: string | null }[]) {
    if (row.pnl !== null) total += Number(row.pnl);
  }
  return total;
}

async function loadTodayRealizedLoss(
  supabase: SupabaseClient,
  ownerId: UUID,
  now: Date,
): Promise<number> {
  const dayStart = startOfUtcDayIso(now);
  const { data, error } = await supabase
    .from('trades')
    .select('pnl, exit_at')
    .eq('owner_id', ownerId)
    .gte('exit_at', dayStart)
    .not('pnl', 'is', null);
  if (error) throw error;
  let lossSum = 0;
  for (const row of (data ?? []) as { pnl: string | null; exit_at: string | null }[]) {
    if (row.pnl === null) continue;
    const v = Number(row.pnl);
    if (v < 0) lossSum += -v;
  }
  return lossSum;
}

async function loadEodBalances(
  supabase: SupabaseClient,
  ownerId: UUID,
  profileId: UUID,
): Promise<number[]> {
  const { data, error } = await supabase
    .from('prop_firm_eod_balances')
    .select('eod_balance, eod_date')
    .eq('owner_id', ownerId)
    .eq('profile_id', profileId)
    .order('eod_date', { ascending: true });
  if (error) {
    // Table may not exist yet in some environments (migration 0011 pending).
    // Treat as empty history rather than failing the whole room computation.
    return [];
  }
  return ((data ?? []) as { eod_balance: string }[]).map((r) => Number(r.eod_balance));
}

async function loadContext(
  supabase: SupabaseClient,
  ownerId: UUID,
  profile: PropFirmProfile,
  now: Date,
): Promise<TodayContext> {
  const [cumulative, todayLoss, eod] = await Promise.all([
    loadCumulativePnl(supabase, ownerId),
    loadTodayRealizedLoss(supabase, ownerId, now),
    loadEodBalances(supabase, ownerId, profile.id),
  ]);
  return {
    cumulativeRealizedPnl: cumulative,
    todayRealizedLoss: todayLoss,
    eodBalances: eod,
  };
}

export async function computeRoomForProfile(
  supabase: SupabaseClient,
  ownerId: UUID,
  profile: PropFirmProfile,
  now: Date = new Date(),
): Promise<PropFirmCurrentRoom> {
  const ctx = await loadContext(supabase, ownerId, profile, now);
  const currentEquity = Number(profile.account_size) + ctx.cumulativeRealizedPnl;
  return evaluateRoom(profile, {
    eodBalances: ctx.eodBalances,
    currentEquity,
    todayRealizedLoss: ctx.todayRealizedLoss,
    // v1: no per-tick equity curve. Use current equity as a single point so
    // intraday_trailing falls back to "peak = current" until EOD posts.
    equityCurveIntraday: [currentEquity],
  });
}

function toResponse(
  profile: PropFirmProfile,
  room: PropFirmCurrentRoom,
  lastComputedAt: string,
): PropFirmProfileResponse {
  return {
    id: profile.id,
    firmName: profile.firm_name,
    firmLabel: profile.firm_label,
    accountSize: Number(profile.account_size),
    drawdownType: profile.drawdown_type,
    drawdownLimit: Number(profile.drawdown_limit),
    dailyLossLimit: profile.daily_loss_limit === null ? null : Number(profile.daily_loss_limit),
    warnThresholdPct: Number(profile.warn_threshold_pct),
    isActive: profile.is_active,
    currentRoom: room,
    lastComputedAt,
  };
}

export async function getRoomsForUser(
  supabase: SupabaseClient,
  ownerId: UUID,
): Promise<PropFirmProfileResponse[]> {
  const profiles = await listProfiles(supabase, ownerId, false);
  if (profiles.length === 0) return [];
  const now = new Date();
  const computedAt = now.toISOString();
  const rooms = await Promise.all(
    profiles.map((p) => computeRoomForProfile(supabase, ownerId, p, now)),
  );
  return profiles.map((p, i) => toResponse(p, rooms[i], computedAt));
}

export { toResponse as propFirmProfileToResponse };
