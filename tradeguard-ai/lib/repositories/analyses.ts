// Repository for `analyses` + behavioral profile aggregates exposed at
// `/api/analysis/{profile,hourly-winrate,atr-buckets}`. Reads do groupings
// in-memory after a constrained query — fine for single-user SaaS where N is
// at most a few thousand trades.

import type { SupabaseClient } from '@supabase/supabase-js';
import type { Analysis, BehavioralProfile, MarketSnapshot, Trade, UUID } from '@/types/db';
import type { AtrBucket, HourlyWinRateBucket } from '@/types/api';
import { hourOfDayUtc } from '@/lib/utils/time';

export interface NewAnalysisInput {
  trade_id: UUID;
  stop_delay_score: number | null;
  revenge_score: number | null;
  overconfidence_score: number | null;
  risk_score?: number | null;
  retrospective_text?: string | null;
  retrospective_status: Analysis['retrospective_status'];
  llm_input_snapshot?: Record<string, unknown> | null;
  llm_token_usage?: Analysis['llm_token_usage'];
}

export async function insertAnalysisBatch(
  supabase: SupabaseClient,
  ownerId: UUID,
  items: NewAnalysisInput[],
): Promise<Analysis[]> {
  if (items.length === 0) return [];
  const rows = items.map((i) => ({
    trade_id: i.trade_id,
    owner_id: ownerId,
    stop_delay_score: i.stop_delay_score,
    revenge_score: i.revenge_score,
    overconfidence_score: i.overconfidence_score,
    risk_score: i.risk_score ?? null,
    retrospective_text: i.retrospective_text ?? null,
    retrospective_status: i.retrospective_status,
    llm_input_snapshot: i.llm_input_snapshot ?? null,
    llm_token_usage: i.llm_token_usage ?? null,
  }));
  const { data, error } = await supabase.from('analyses').insert(rows).select('*');
  if (error) throw error;
  return (data ?? []) as Analysis[];
}

export async function getProfileAggregates(
  supabase: SupabaseClient,
  ownerId: UUID,
): Promise<BehavioralProfile | null> {
  const { data, error } = await supabase
    .from('behavioral_profiles')
    .select('*')
    .eq('owner_id', ownerId)
    .maybeSingle<BehavioralProfile>();
  if (error) throw error;
  return data;
}

export async function upsertBehavioralProfile(
  supabase: SupabaseClient,
  ownerId: UUID,
  profile: Omit<BehavioralProfile, 'owner_id'>,
): Promise<BehavioralProfile> {
  const { data, error } = await supabase
    .from('behavioral_profiles')
    .upsert({ owner_id: ownerId, ...profile })
    .select('*')
    .single<BehavioralProfile>();
  if (error) throw error;
  return data;
}

export async function getTradesWithoutAnalysis(
  supabase: SupabaseClient,
  ownerId: UUID,
): Promise<Trade[]> {
  // Two-step: list all trades, then exclude those with an existing analyses row.
  const { data: trades, error } = await supabase.from('trades').select('*').eq('owner_id', ownerId);
  if (error) throw error;
  const ids = (trades ?? []).map((t) => (t as Trade).id);
  if (ids.length === 0) return [];
  const { data: analyses, error: aErr } = await supabase
    .from('analyses')
    .select('trade_id')
    .in('trade_id', ids);
  if (aErr) throw aErr;
  const analyzed = new Set((analyses ?? []).map((a) => a.trade_id as UUID));
  return (trades as Trade[]).filter((t) => !analyzed.has(t.id));
}

export async function getHourlyWinRate(
  supabase: SupabaseClient,
  ownerId: UUID,
  symbol?: string,
): Promise<HourlyWinRateBucket[]> {
  let query = supabase
    .from('trades')
    .select('entry_at, pnl')
    .eq('owner_id', ownerId)
    .not('pnl', 'is', null);
  if (symbol) query = query.eq('symbol', symbol);
  const { data, error } = await query;
  if (error) throw error;

  const buckets: HourlyWinRateBucket[] = Array.from({ length: 24 }, (_, h) => ({
    hourUtc: h,
    trades: 0,
    wins: 0,
    winRate: null,
    totalPnL: 0,
  }));
  for (const row of (data ?? []) as { entry_at: string; pnl: string }[]) {
    const hour = hourOfDayUtc(row.entry_at);
    const pnl = Number(row.pnl);
    const b = buckets[hour];
    b.trades += 1;
    b.totalPnL += pnl;
    if (pnl > 0) b.wins += 1;
  }
  for (const b of buckets) {
    b.winRate = b.trades > 0 ? Number((b.wins / b.trades).toFixed(4)) : null;
    b.totalPnL = Number(b.totalPnL.toFixed(2));
  }
  return buckets;
}

const ATR_RANGES: { bucket: AtrBucket['bucket']; range: [number, number | null] }[] = [
  { bucket: 'low', range: [0, 20] },
  { bucket: 'normal', range: [20, 40] },
  { bucket: 'high', range: [40, null] },
];

function classifyAtr(atr14: number | null): AtrBucket['bucket'] {
  if (atr14 === null) return 'normal';
  if (atr14 < 20) return 'low';
  if (atr14 < 40) return 'normal';
  return 'high';
}

export async function getAtrBuckets(supabase: SupabaseClient, ownerId: UUID): Promise<AtrBucket[]> {
  // Pull closed trades, then snapshots, then bucket.
  const { data: trades, error: tErr } = await supabase
    .from('trades')
    .select('id, pnl')
    .eq('owner_id', ownerId)
    .not('pnl', 'is', null);
  if (tErr) throw tErr;
  const tradeRows = (trades ?? []) as { id: UUID; pnl: string }[];
  const ids = tradeRows.map((t) => t.id);
  let snapshots: Pick<MarketSnapshot, 'trade_id' | 'atr_14'>[] = [];
  if (ids.length > 0) {
    const { data, error } = await supabase
      .from('market_snapshots')
      .select('trade_id, atr_14')
      .in('trade_id', ids);
    if (error) throw error;
    snapshots = (data ?? []) as Pick<MarketSnapshot, 'trade_id' | 'atr_14'>[];
  }
  const atrByTrade = new Map<UUID, number | null>();
  for (const s of snapshots) {
    atrByTrade.set(s.trade_id, s.atr_14 === null ? null : Number(s.atr_14));
  }

  const stats = new Map<AtrBucket['bucket'], { trades: number; wins: number; totalPnL: number }>();
  for (const { bucket } of ATR_RANGES) {
    stats.set(bucket, { trades: 0, wins: 0, totalPnL: 0 });
  }
  for (const t of tradeRows) {
    const atr = atrByTrade.has(t.id) ? (atrByTrade.get(t.id) ?? null) : null;
    const bucket = classifyAtr(atr);
    const s = stats.get(bucket);
    if (!s) continue;
    const pnl = Number(t.pnl);
    s.trades += 1;
    s.totalPnL += pnl;
    if (pnl > 0) s.wins += 1;
  }
  return ATR_RANGES.map((cfg) => {
    const s = stats.get(cfg.bucket) ?? { trades: 0, wins: 0, totalPnL: 0 };
    return {
      bucket: cfg.bucket,
      atrRange: cfg.range,
      trades: s.trades,
      winRate: s.trades > 0 ? Number((s.wins / s.trades).toFixed(4)) : 0,
      totalPnL: Number(s.totalPnL.toFixed(2)),
    };
  });
}
