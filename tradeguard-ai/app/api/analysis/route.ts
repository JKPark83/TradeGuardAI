// POST /api/analysis — (re)compute deterministic behavioral scores for trades.
// Body: { tradeIds?: UUID[], scope: 'all' | 'uncomputed' }.

import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { toApiResponse, unauthenticated, validationError } from '@/lib/utils/api-error';
import { withRequestId } from '@/lib/utils/logger';
import { recomputeAnalysesForTrades } from '@/lib/services/behavioral-analysis';
import { recomputeBehavioralProfile } from '@/lib/services/behavioral-profile-recompute';
import { uuidSchema } from '@/lib/validation/common';

const bodySchema = z
  .object({
    tradeIds: z.array(uuidSchema).optional().nullable(),
    scope: z.enum(['all', 'uncomputed']).default('uncomputed'),
  })
  .strict();

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

    let json: unknown;
    try {
      json = await req.json();
    } catch {
      json = {};
    }
    const parsed = bodySchema.safeParse(json);
    if (!parsed.success) {
      return validationError(
        parsed.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
      );
    }

    const result = await recomputeAnalysesForTrades({
      supabase,
      ownerId: user.id,
      tradeIds: parsed.data.tradeIds ?? null,
      scope: parsed.data.scope,
    });
    // Profile must reflect the new scores. Cheap because computed in-memory.
    await recomputeBehavioralProfile({ supabase, ownerId: user.id });

    log.info('analyses_recomputed', { processed: result.processed });
    return new Response(
      JSON.stringify({
        processed: result.processed,
        skippedDuplicate: 0,
        analyses: result.analyses.map((a) => ({
          tradeId: a.trade_id,
          analysisId: a.id,
          stopDelayScore: a.stop_delay_score,
          revengeScore: a.revenge_score,
          overconfidenceScore: a.overconfidence_score,
        })),
      }),
      { status: 200, headers: { 'Content-Type': 'application/json; charset=utf-8' } },
    );
  } catch (err) {
    log.error('analyses_recompute_failed', {
      message: err instanceof Error ? err.message : String(err),
    });
    return toApiResponse(err, requestId);
  }
}
