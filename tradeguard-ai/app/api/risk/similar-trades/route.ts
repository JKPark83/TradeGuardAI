// GET /api/risk/similar-trades — past trades similar to a candidate.
// Contract: contracts/risk-api.md#get-apirisksimilar-trades.
//
// No LLM. Pure history scan with cosine similarity over (symbol, side,
// vix-proximity, event-match). The `marketContextHint` query param adjusts
// the candidate's implied vix/event for ranking; unrecognized values are
// ignored.

import { z } from 'zod';
import type { SupabaseClient } from '@supabase/supabase-js';
import { createClient } from '@/lib/supabase/server';
import { ApiError, toApiResponse, unauthenticated, validationError } from '@/lib/utils/api-error';
import { withRequestId } from '@/lib/utils/logger';
import { getAllTradesForOwner } from '@/lib/repositories/trades';
import { findSimilarTrades, type SimilarTradeSnapshot } from '@/lib/scoring/similar';
import { tradeSideSchema } from '@/lib/validation/common';
import type { UUID } from '@/types/db';

export const runtime = 'nodejs';

const JSON_HEADERS = { 'Content-Type': 'application/json; charset=utf-8' } as const;

const querySchema = z.object({
  symbol: z.string().min(1).max(32),
  side: tradeSideSchema,
  marketContextHint: z.enum(['vix-high', 'event-near']).optional(),
});

const TOP_K = 10;

function hintToCandidateContext(hint: 'vix-high' | 'event-near' | undefined): {
  vix: number | null;
  event: string | null;
} {
  if (hint === 'vix-high') return { vix: 32, event: null };
  if (hint === 'event-near') return { vix: null, event: 'cpi' };
  return { vix: null, event: null };
}

async function loadSnapshotMap(
  supabase: SupabaseClient,
  ownerId: UUID,
  tradeIds: UUID[],
): Promise<Map<UUID, SimilarTradeSnapshot & { event_offset_minutes: number | null }>> {
  const out = new Map<UUID, SimilarTradeSnapshot & { event_offset_minutes: number | null }>();
  if (tradeIds.length === 0) return out;
  const { data, error } = await supabase
    .from('market_snapshots')
    .select('trade_id, vix, event_type, event_offset_minutes')
    .eq('owner_id', ownerId)
    .in('trade_id', tradeIds);
  if (error) return out;
  for (const row of (data ?? []) as {
    trade_id: UUID;
    vix: string | null;
    event_type: string | null;
    event_offset_minutes: number | null;
  }[]) {
    out.set(row.trade_id, {
      vix: row.vix === null ? null : Number(row.vix),
      event_type: row.event_type,
      event_offset_minutes: row.event_offset_minutes,
    });
  }
  return out;
}

export async function GET(req: Request): Promise<Response> {
  const requestId = crypto.randomUUID();
  const log = withRequestId(requestId);

  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return unauthenticated();

    const url = new URL(req.url);
    const parsed = querySchema.safeParse({
      symbol: url.searchParams.get('symbol') ?? undefined,
      side: url.searchParams.get('side') ?? undefined,
      marketContextHint: url.searchParams.get('marketContextHint') ?? undefined,
    });
    if (!parsed.success) {
      return validationError(
        parsed.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
      );
    }

    const ctx = hintToCandidateContext(parsed.data.marketContextHint);
    const history = await getAllTradesForOwner(supabase, user.id);
    const snapshots = await loadSnapshotMap(
      supabase,
      user.id,
      history.map((t) => t.id),
    );

    const matches = findSimilarTrades({
      history,
      candidate: {
        symbol: parsed.data.symbol,
        side: parsed.data.side,
        currentVix: ctx.vix,
        currentEvent: ctx.event,
      },
      topK: TOP_K,
      snapshotsByTradeId: snapshots,
    });

    const result = matches.map((m) => {
      const trade = history.find((t) => t.id === m.tradeId);
      const snap = snapshots.get(m.tradeId);
      return {
        tradeId: m.tradeId,
        entryAt: trade?.entry_at ?? null,
        pnl: m.pnl,
        vix: snap?.vix ?? null,
        eventOffsetMinutes: snap?.event_offset_minutes ?? null,
        similarity: Number(m.similarity.toFixed(4)),
      };
    });

    log.info('risk_similar_listed', {
      count: result.length,
      symbol: parsed.data.symbol,
      side: parsed.data.side,
    });
    return new Response(JSON.stringify({ matches: result }), {
      status: 200,
      headers: JSON_HEADERS,
    });
  } catch (err) {
    log.error('risk_similar_failed', {
      message: err instanceof Error ? err.message : String(err),
    });
    if (err instanceof ApiError) return err.toResponse();
    return toApiResponse(err, requestId);
  }
}
