// Service: day-by-day equity timeline for a prop-firm profile (dashboard chart).
//
// Reads from `prop_firm_eod_balances` for the requested [from, to] window,
// computes the running `drawdownFloor` per the profile's rule type, and
// flags days that crossed the warning threshold.

import type { SupabaseClient } from '@supabase/supabase-js';
import type { PropFirmProfile, UUID } from '@/types/db';
import { getProfile } from '@/lib/repositories/prop-firm';

export interface TimelinePoint {
  date: string; // YYYY-MM-DD
  eodEquity: number;
  drawdownFloor: number;
  dailyPnL: number;
  warningHit: boolean;
}

interface EodRow {
  eod_date: string;
  eod_balance: string;
  daily_pnl: string;
}

function computeFloor(
  profile: PropFirmProfile,
  pastEodBalances: number[],
  currentEod: number,
): number {
  const limit = Number(profile.drawdown_limit);
  switch (profile.drawdown_type) {
    case 'static':
      return Number(profile.account_size) - limit;
    case 'eod_trailing': {
      const series = [...pastEodBalances, currentEod];
      return Math.max(...series) - limit;
    }
    case 'intraday_trailing': {
      // We do not have intraday curves in the persisted timeline, so we
      // approximate by treating each day's EOD as that day's peak. This is
      // documented as a v1 limitation in research.md §R-08.
      const series = [...pastEodBalances, currentEod];
      return Math.max(...series) - limit;
    }
  }
}

export async function getEquityTimeline(
  supabase: SupabaseClient,
  ownerId: UUID,
  profileId: UUID,
  from: string,
  to: string,
): Promise<TimelinePoint[]> {
  const profile = await getProfile(supabase, ownerId, profileId);
  if (!profile) return [];

  const { data, error } = await supabase
    .from('prop_firm_eod_balances')
    .select('eod_date, eod_balance, daily_pnl')
    .eq('owner_id', ownerId)
    .eq('profile_id', profileId)
    .gte('eod_date', from)
    .lte('eod_date', to)
    .order('eod_date', { ascending: true });
  if (error) throw error;

  const rows = (data ?? []) as EodRow[];
  if (rows.length === 0) return [];

  const warnThreshold = Number(profile.warn_threshold_pct);
  const drawdownLimit = Number(profile.drawdown_limit);
  const past: number[] = [];
  const out: TimelinePoint[] = [];

  for (const r of rows) {
    const eodEquity = Number(r.eod_balance);
    const dailyPnL = Number(r.daily_pnl);
    const floor = computeFloor(profile, past, eodEquity);
    const room = eodEquity - floor;
    const warningHit = drawdownLimit > 0 && room / drawdownLimit < 1 - warnThreshold;
    out.push({
      date: r.eod_date,
      eodEquity,
      drawdownFloor: floor,
      dailyPnL,
      warningHit,
    });
    past.push(eodEquity);
  }
  return out;
}
