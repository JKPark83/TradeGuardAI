// GET /api/analysis/hourly-winrate — 24-bucket UTC hour win rate (FR-007).
// Query: ?symbol=NQ to scope to a single symbol.

import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { toApiResponse, unauthenticated, validationError } from '@/lib/utils/api-error';
import { withRequestId } from '@/lib/utils/logger';
import { getHourlyWinRate } from '@/lib/repositories/analyses';

const querySchema = z.object({ symbol: z.string().min(1).optional() });

export const runtime = 'nodejs';

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
    const parsed = querySchema.safeParse(Object.fromEntries(url.searchParams));
    if (!parsed.success) {
      return validationError(
        parsed.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
      );
    }
    const buckets = await getHourlyWinRate(supabase, user.id, parsed.data.symbol);
    log.info('hourly_winrate_computed', { symbol: parsed.data.symbol ?? 'all' });
    return new Response(JSON.stringify({ buckets }), {
      status: 200,
      headers: { 'Content-Type': 'application/json; charset=utf-8' },
    });
  } catch (err) {
    log.error('hourly_winrate_failed', {
      message: err instanceof Error ? err.message : String(err),
    });
    return toApiResponse(err, requestId);
  }
}
