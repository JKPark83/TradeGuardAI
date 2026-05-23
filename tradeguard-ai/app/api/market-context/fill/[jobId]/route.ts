// GET /api/market-context/fill/:jobId — poll an in-process backfill job.
//
// Authorization: the in-memory `jobStore` is keyed by an opaque UUID, but we
// still load the job and verify `ownerId` matches `auth.uid()`. A wrong-owner
// lookup returns 404 (per contracts/account-api.md, never 403 — to avoid
// leaking job-id existence).

import { createClient } from '@/lib/supabase/server';
import { notFound, toApiResponse, unauthenticated, validationError } from '@/lib/utils/api-error';
import { withRequestId } from '@/lib/utils/logger';
import { uuidSchema } from '@/lib/validation/common';
import { getJobState } from '@/lib/services/market-context';

export const runtime = 'nodejs';

interface RouteContext {
  params: Promise<{ jobId: string }>;
}

export async function GET(_req: Request, ctx: RouteContext): Promise<Response> {
  const requestId = crypto.randomUUID();
  const log = withRequestId(requestId);
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return unauthenticated();

    const { jobId } = await ctx.params;
    const parsed = uuidSchema.safeParse(jobId);
    if (!parsed.success) {
      return validationError([{ path: 'jobId', message: 'invalid uuid' }]);
    }

    const state = getJobState(parsed.data);
    if (!state || state.ownerId !== user.id) {
      return notFound();
    }

    const body = {
      jobId: state.jobId,
      status: state.status,
      filled: state.filled,
      skippedNoData: state.skippedNoData,
      failed: state.failed,
      total: state.total,
    };
    log.info('market_context_job_polled', { jobId: state.jobId, status: state.status });
    return new Response(JSON.stringify(body), {
      status: 200,
      headers: { 'Content-Type': 'application/json; charset=utf-8' },
    });
  } catch (err) {
    log.error('market_context_job_poll_failed', {
      message: err instanceof Error ? err.message : String(err),
    });
    return toApiResponse(err, requestId);
  }
}
