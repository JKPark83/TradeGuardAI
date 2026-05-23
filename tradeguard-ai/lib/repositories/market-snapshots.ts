// Repository for `market_snapshots`. Trade ↔ Snapshot is 1:0..1, so all
// reads are keyed by `trade_id` (PK). owner_id is required on every call to
// keep the authorization decision at the route boundary — see trades.ts for
// the same convention.

import type { SupabaseClient } from '@supabase/supabase-js';
import type { EventType, MarketDataSource, MarketSnapshot, UUID } from '@/types/db';

export interface NewMarketSnapshot {
  trade_id: UUID;
  symbol: string;
  snapshot_at: string;
  vix: string | null;
  dxy: string | null;
  volume: string | null;
  atr_14: string | null;
  event_type: EventType | null;
  event_offset_minutes: number | null;
  data_source: MarketDataSource;
}

/** Fetch the (single) snapshot row for a trade, if it exists. */
export async function getSnapshotForTrade(
  supabase: SupabaseClient,
  ownerId: UUID,
  tradeId: UUID,
): Promise<MarketSnapshot | null> {
  const { data, error } = await supabase
    .from('market_snapshots')
    .select('*')
    .eq('owner_id', ownerId)
    .eq('trade_id', tradeId)
    .maybeSingle<MarketSnapshot>();
  if (error) throw error;
  return data;
}

/**
 * Upsert a snapshot keyed on `trade_id` (PK). PostgREST exposes `upsert`
 * with `onConflict` which compiles to `INSERT ... ON CONFLICT (trade_id)
 * DO UPDATE SET ...`. We pass `defaultToNull: false` so partial updates
 * preserve previously-stored fields when a re-run only fills in some.
 *
 * Wait — `defaultToNull` isn't applicable here because we always send the
 * full row. We rely on the caller to supply every column; the previous row
 * is overwritten in full.
 */
export async function upsertSnapshot(
  supabase: SupabaseClient,
  ownerId: UUID,
  snapshot: NewMarketSnapshot,
): Promise<void> {
  const row = { owner_id: ownerId, ...snapshot };
  const { error } = await supabase.from('market_snapshots').upsert(row, { onConflict: 'trade_id' });
  if (error) throw error;
}

/**
 * Return the trade ids (subset of `tradeIds` when provided, otherwise all
 * trades for the owner) that do NOT yet have a market_snapshots row.
 *
 * Two-step query rather than a NOT EXISTS subquery because PostgREST does
 * not expose join-style filtering; same approach as `getTradesWithoutAnalysis`.
 */
export async function listMissingTradeIds(
  supabase: SupabaseClient,
  ownerId: UUID,
  tradeIds?: UUID[],
): Promise<UUID[]> {
  let tradeQuery = supabase.from('trades').select('id').eq('owner_id', ownerId);
  if (tradeIds && tradeIds.length > 0) {
    tradeQuery = tradeQuery.in('id', tradeIds);
  }
  const { data: trades, error: tErr } = await tradeQuery;
  if (tErr) throw tErr;
  const ids = (trades ?? []).map((t) => (t as { id: UUID }).id);
  if (ids.length === 0) return [];

  const { data: snapshots, error: sErr } = await supabase
    .from('market_snapshots')
    .select('trade_id')
    .in('trade_id', ids);
  if (sErr) throw sErr;
  const haveSnapshot = new Set((snapshots ?? []).map((s) => (s as { trade_id: UUID }).trade_id));
  return ids.filter((id) => !haveSnapshot.has(id));
}
