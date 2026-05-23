// GET /api/risk/assessments/recent — recent risk assessments for the user.
// Contract: contracts/risk-api.md#get-apiriskassessmentsrecent.

import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { ApiError, toApiResponse, unauthenticated, validationError } from '@/lib/utils/api-error';
import { withRequestId } from '@/lib/utils/logger';
import { listRecent } from '@/lib/repositories/risk-assessments';

export const runtime = 'nodejs';

const JSON_HEADERS = { 'Content-Type': 'application/json; charset=utf-8' } as const;

const querySchema = z.object({
  limit: z.coerce.number().int().positive().max(100).default(20),
});

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
      limit: url.searchParams.get('limit') ?? undefined,
    });
    if (!parsed.success) {
      return validationError(
        parsed.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
      );
    }

    const assessments = await listRecent(supabase, user.id, parsed.data.limit);
    log.info('risk_recent_listed', { count: assessments.length });
    return new Response(JSON.stringify({ assessments }), {
      status: 200,
      headers: JSON_HEADERS,
    });
  } catch (err) {
    log.error('risk_recent_failed', {
      message: err instanceof Error ? err.message : String(err),
    });
    if (err instanceof ApiError) return err.toResponse();
    return toApiResponse(err, requestId);
  }
}
