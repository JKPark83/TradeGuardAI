// GET /api/market-context/upcoming-events — dashboard widget for economic calendar.
//
// Read-only, no DB writes. The Finnhub adapter handles rate-limiting + caching;
// failure returns an empty list rather than 500 (matching FR-010's "data not
// available" UX rule).

import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { toApiResponse, unauthenticated, validationError } from '@/lib/utils/api-error';
import { withRequestId } from '@/lib/utils/logger';
import { fetchEconomicCalendar } from '@/lib/market/finnhub';

const DEFAULT_WINDOW_HOURS = 24;
const MAX_WINDOW_HOURS = 24 * 14;

const querySchema = z.object({
  windowHours: z.coerce
    .number()
    .int()
    .positive()
    .max(MAX_WINDOW_HOURS)
    .default(DEFAULT_WINDOW_HOURS),
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
    const { windowHours } = parsed.data;

    const now = new Date();
    const to = new Date(now.getTime() + windowHours * 60 * 60 * 1000);
    const events = await fetchEconomicCalendar(now, to);
    // Future-only: callers want a forward-looking widget.
    const upcoming = events.filter((e) => new Date(e.scheduledAt).getTime() >= now.getTime());

    log.info('upcoming_events_listed', { count: upcoming.length, windowHours });
    return new Response(JSON.stringify({ events: upcoming }), {
      status: 200,
      headers: { 'Content-Type': 'application/json; charset=utf-8' },
    });
  } catch (err) {
    log.error('upcoming_events_failed', {
      message: err instanceof Error ? err.message : String(err),
    });
    return toApiResponse(err, requestId);
  }
}
