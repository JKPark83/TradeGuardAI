// GET /api/trades — list trades with filters + cursor pagination.

import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { toApiResponse, unauthenticated, validationError } from '@/lib/utils/api-error';
import { withRequestId } from '@/lib/utils/logger';
import { listTrades } from '@/lib/repositories/trades';

const querySchema = z.object({
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
  symbol: z.string().min(1).optional(),
  status: z.enum(['open', 'closed', 'all']).default('all'),
  limit: z.coerce.number().int().positive().max(500).default(50),
  cursor: z.string().optional(),
});

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

    const result = await listTrades(supabase, user.id, parsed.data);
    log.info('trades_listed', { count: result.trades.length });
    return new Response(JSON.stringify(result), {
      status: 200,
      headers: { 'Content-Type': 'application/json; charset=utf-8' },
    });
  } catch (err) {
    log.error('trades_list_failed', { message: err instanceof Error ? err.message : String(err) });
    return toApiResponse(err, requestId);
  }
}
