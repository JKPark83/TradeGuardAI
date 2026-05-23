// Repository for `trades` (+ related read joins). All functions accept a Supabase
// client created in the caller (RSC, Route Handler, Edge Function) — never reads
// auth context itself. owner_id is always passed explicitly to keep authorization
// decisions at the route boundary.
//
// NUMERIC columns come back from PostgREST as strings to preserve precision; we
// convert to JS `number` at the API boundary via helpers in `trades-mappers.ts`.

import type { SupabaseClient } from '@supabase/supabase-js';
import type { MarketSnapshot, Trade, TradeSide, UUID } from '@/types/db';
import type { TradesListResponse } from '@/types/api';
import {
  toAnalysisDetail,
  toMarketSnapshotDetail,
  toTradeSummary,
  type TradeDetail,
} from './trades-mappers';

const PG_UNIQUE_VIOLATION = '23505';

export type { TradeDetail } from './trades-mappers';

export interface NewTrade {
  symbol: string;
  side: TradeSide;
  entry_price: string;
  exit_price: string | null;
  entry_at: string;
  exit_at: string | null;
  pnl: string | null;
  contracts: string;
  source_csv_id?: UUID | null;
  source_row?: number | null;
  session_id?: UUID | null;
}

export interface ListTradesParams {
  from?: string;
  to?: string;
  symbol?: string;
  status?: 'open' | 'closed' | 'all';
  limit: number;
  cursor?: string;
}

export async function insertTrades(
  supabase: SupabaseClient,
  ownerId: UUID,
  trades: NewTrade[],
): Promise<{ inserted: Trade[]; duplicates: number }> {
  if (trades.length === 0) return { inserted: [], duplicates: 0 };
  const rows = trades.map((t) => ({ ...t, owner_id: ownerId }));
  const inserted: Trade[] = [];
  let duplicates = 0;
  // Insert one-by-one so duplicates (UNIQUE INDEX violation) are silently skipped
  // without aborting the whole batch. Bulk insert + ON CONFLICT DO NOTHING is
  // not exposed through PostgREST.
  for (const row of rows) {
    const { data, error } = await supabase
      .from('trades')
      .insert(row)
      .select('*')
      .maybeSingle<Trade>();
    if (error) {
      if (error.code === PG_UNIQUE_VIOLATION) {
        duplicates++;
        continue;
      }
      throw error;
    }
    if (data) inserted.push(data);
  }
  return { inserted, duplicates };
}

export async function listTrades(
  supabase: SupabaseClient,
  ownerId: UUID,
  params: ListTradesParams,
): Promise<TradesListResponse> {
  let query = supabase
    .from('trades')
    .select('*', { count: 'exact' })
    .eq('owner_id', ownerId)
    .order('entry_at', { ascending: false })
    .limit(params.limit + 1);

  if (params.from) query = query.gte('entry_at', params.from);
  if (params.to) query = query.lte('entry_at', params.to);
  if (params.symbol) query = query.eq('symbol', params.symbol);
  if (params.status === 'open') query = query.is('exit_at', null);
  if (params.status === 'closed') query = query.not('exit_at', 'is', null);
  if (params.cursor) query = query.lt('entry_at', params.cursor);

  const { data, error, count } = await query;
  if (error) throw error;
  const rows = (data ?? []) as Trade[];
  const hasMore = rows.length > params.limit;
  const sliced = hasMore ? rows.slice(0, params.limit) : rows;
  const nextCursor = hasMore ? sliced[sliced.length - 1].entry_at : null;

  const tradeIds = sliced.map((r) => r.id);
  const [snapshots, analyses] = await Promise.all([
    tradeIds.length
      ? supabase.from('market_snapshots').select('trade_id').in('trade_id', tradeIds)
      : Promise.resolve({ data: [], error: null }),
    tradeIds.length
      ? supabase
          .from('analyses')
          .select('id, trade_id, risk_score, created_at')
          .in('trade_id', tradeIds)
          .order('created_at', { ascending: false })
      : Promise.resolve({ data: [], error: null }),
  ]);
  if (snapshots.error) throw snapshots.error;
  if (analyses.error) throw analyses.error;

  const snapshotSet = new Set((snapshots.data ?? []).map((r) => r.trade_id as UUID));
  const latestByTrade = new Map<UUID, { id: UUID; risk_score: number | null }>();
  for (const a of (analyses.data ?? []) as {
    id: UUID;
    trade_id: UUID;
    risk_score: number | null;
  }[]) {
    if (!latestByTrade.has(a.trade_id)) {
      latestByTrade.set(a.trade_id, { id: a.id, risk_score: a.risk_score });
    }
  }

  const summaries = sliced.map((t) =>
    toTradeSummary(t, snapshotSet.has(t.id), latestByTrade.get(t.id) ?? null),
  );

  const closed = sliced.filter((t) => t.pnl !== null);
  const totalPnL = closed.reduce((acc, t) => acc + Number(t.pnl), 0);
  const wins = closed.filter((t) => Number(t.pnl) > 0).length;
  const winRate = closed.length > 0 ? wins / closed.length : 0;

  return {
    trades: summaries,
    nextCursor,
    summary: {
      total: count ?? sliced.length,
      winRate: Number(winRate.toFixed(4)),
      totalPnL: Number(totalPnL.toFixed(2)),
    },
  };
}

export async function getTradeById(
  supabase: SupabaseClient,
  ownerId: UUID,
  id: UUID,
): Promise<TradeDetail | null> {
  const { data: trade, error: tradeErr } = await supabase
    .from('trades')
    .select('*')
    .eq('owner_id', ownerId)
    .eq('id', id)
    .maybeSingle<Trade>();
  if (tradeErr) throw tradeErr;
  if (!trade) return null;

  const [{ data: analyses, error: aErr }, { data: snapshot, error: sErr }] = await Promise.all([
    supabase
      .from('analyses')
      .select('*')
      .eq('trade_id', id)
      .order('created_at', { ascending: false }),
    supabase.from('market_snapshots').select('*').eq('trade_id', id).maybeSingle<MarketSnapshot>(),
  ]);
  if (aErr) throw aErr;
  if (sErr) throw sErr;

  const analysesTyped = (analyses ?? []).map((a) => toAnalysisDetail(a));
  const latest = analysesTyped[0] ?? null;
  const tradeSummary = toTradeSummary(
    trade,
    snapshot !== null,
    latest ? { id: latest.id, risk_score: latest.riskScore } : null,
  );

  return {
    trade: tradeSummary,
    analyses: analysesTyped,
    marketSnapshot: snapshot ? toMarketSnapshotDetail(snapshot) : null,
  };
}

export async function deleteTrade(
  supabase: SupabaseClient,
  ownerId: UUID,
  id: UUID,
): Promise<boolean> {
  const { error, count } = await supabase
    .from('trades')
    .delete({ count: 'exact' })
    .eq('owner_id', ownerId)
    .eq('id', id);
  if (error) throw error;
  return (count ?? 0) > 0;
}

export async function getTradesByIds(
  supabase: SupabaseClient,
  ownerId: UUID,
  ids: UUID[],
): Promise<Trade[]> {
  if (ids.length === 0) return [];
  const { data, error } = await supabase
    .from('trades')
    .select('*')
    .eq('owner_id', ownerId)
    .in('id', ids);
  if (error) throw error;
  return (data ?? []) as Trade[];
}

export async function getAllTradesForOwner(
  supabase: SupabaseClient,
  ownerId: UUID,
): Promise<Trade[]> {
  const { data, error } = await supabase
    .from('trades')
    .select('*')
    .eq('owner_id', ownerId)
    .order('entry_at', { ascending: true });
  if (error) throw error;
  return (data ?? []) as Trade[];
}
