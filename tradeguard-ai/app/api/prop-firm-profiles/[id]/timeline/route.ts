// GET /api/prop-firm-profiles/:id/timeline?from=YYYY-MM-DD&to=YYYY-MM-DD
//
// Returns per-day EOD equity + drawdown floor for charting. Contract: see
// contracts/prop-firm-api.md (`GET /api/prop-firm-profiles/:id/timeline`).

import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { toApiResponse, unauthenticated, validationError } from '@/lib/utils/api-error';
import { withRequestId } from '@/lib/utils/logger';
import { uuidSchema } from '@/lib/validation/common';
import { getEquityTimeline } from '@/lib/services/prop-firm-timeline';

export const runtime = 'nodejs';

const JSON_HEADERS = { 'Content-Type': 'application/json; charset=utf-8' } as const;

const datePattern = /^\d{4}-\d{2}-\d{2}$/;
const querySchema = z.object({
  from: z.string().regex(datePattern, 'from must be YYYY-MM-DD'),
  to: z.string().regex(datePattern, 'to must be YYYY-MM-DD'),
});

interface RouteContext {
  params: Promise<{ id: string }>;
}

export async function GET(req: Request, ctx: RouteContext): Promise<Response> {
  const requestId = crypto.randomUUID();
  const log = withRequestId(requestId);
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return unauthenticated();

    const { id } = await ctx.params;
    const idParsed = uuidSchema.safeParse(id);
    if (!idParsed.success) {
      return validationError([{ path: 'id', message: 'invalid uuid' }]);
    }

    const url = new URL(req.url);
    const queryParsed = querySchema.safeParse({
      from: url.searchParams.get('from') ?? '',
      to: url.searchParams.get('to') ?? '',
    });
    if (!queryParsed.success) {
      return validationError(
        queryParsed.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
      );
    }

    const timeline = await getEquityTimeline(
      supabase,
      user.id,
      idParsed.data,
      queryParsed.data.from,
      queryParsed.data.to,
    );
    log.info('prop_firm_timeline_fetched', {
      profileId: idParsed.data,
      points: timeline.length,
    });
    return new Response(JSON.stringify({ timeline }), { status: 200, headers: JSON_HEADERS });
  } catch (err) {
    log.error('prop_firm_timeline_failed', {
      message: err instanceof Error ? err.message : String(err),
    });
    return toApiResponse(err, requestId);
  }
}
