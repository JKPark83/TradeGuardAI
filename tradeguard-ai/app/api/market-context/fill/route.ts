// POST /api/market-context/fill — kick off an async snapshot backfill (US3).
//
// Returns 202 with a `jobId` the client polls via GET /api/market-context/fill/:jobId.
// The job runs as a fire-and-forget Promise in the same Node process — adequate
// for the single-user runtime (R-01). Multi-instance deployments will need to
// migrate the in-memory `jobStore` to Redis or a Supabase table.

import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { toApiResponse, unauthenticated, validationError } from '@/lib/utils/api-error';
import { withRequestId } from '@/lib/utils/logger';
import { uuidSchema } from '@/lib/validation/common';
import { listMissingTradeIds } from '@/lib/repositories/market-snapshots';
import { startBackfillJob } from '@/lib/services/market-context';
import { getTradesByIds, getAllTradesForOwner } from '@/lib/repositories/trades';

const bodySchema = z.object({
  tradeIds: z.array(uuidSchema).max(5000).optional(),
  scope: z.enum(['missing_only', 'all']).optional(),
});

// Heuristic: ~3 trades/sec given Yahoo+Finnhub limiters in parallel.
const ESTIMATED_SECONDS_PER_TRADE = 0.35;

export const runtime = 'nodejs';

export async function POST(req: Request): Promise<Response> {
  const requestId = crypto.randomUUID();
  const log = withRequestId(requestId);
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return unauthenticated();

    let raw: unknown = {};
    const contentType = req.headers.get('content-type') ?? '';
    if (contentType.includes('application/json')) {
      try {
        raw = await req.json();
      } catch {
        return validationError([{ path: 'body', message: 'invalid JSON' }]);
      }
    }
    const parsed = bodySchema.safeParse(raw);
    if (!parsed.success) {
      return validationError(
        parsed.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
      );
    }

    const { tradeIds, scope = 'missing_only' } = parsed.data;

    // Pre-compute the queue size so we can return `queued` + `estimatedSeconds`
    // in the 202 response. The actual job re-resolves the targets when it runs
    // — these two calls may diverge if trades change concurrently, but the
    // single-user invariant keeps that risk near zero.
    let queued: number;
    if (scope === 'all') {
      if (tradeIds && tradeIds.length > 0) {
        const trades = await getTradesByIds(supabase, user.id, tradeIds);
        queued = trades.length;
      } else {
        const trades = await getAllTradesForOwner(supabase, user.id);
        queued = trades.length;
      }
    } else {
      const missing = await listMissingTradeIds(supabase, user.id, tradeIds);
      queued = missing.length;
    }

    const job = startBackfillJob({
      supabase,
      ownerId: user.id,
      tradeIds,
      scope,
      estimatedTotal: queued,
    });

    const estimatedSeconds = Math.max(1, Math.ceil(queued * ESTIMATED_SECONDS_PER_TRADE));
    log.info('market_context_backfill_started', {
      jobId: job.jobId,
      ownerId: user.id,
      queued,
      scope,
    });
    return new Response(JSON.stringify({ jobId: job.jobId, queued, estimatedSeconds }), {
      status: 202,
      headers: { 'Content-Type': 'application/json; charset=utf-8' },
    });
  } catch (err) {
    log.error('market_context_fill_failed', {
      message: err instanceof Error ? err.message : String(err),
    });
    return toApiResponse(err, requestId);
  }
}
