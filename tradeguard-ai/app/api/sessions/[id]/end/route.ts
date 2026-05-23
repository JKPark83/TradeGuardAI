// PATCH /api/sessions/:id/end — end an active session. Returns endedAt + trade count.

import { createClient } from '@/lib/supabase/server';
import { notFound, toApiResponse, unauthenticated, validationError } from '@/lib/utils/api-error';
import { withRequestId } from '@/lib/utils/logger';
import { endSession, getSessionTradesSummary } from '@/lib/repositories/sessions';
import { uuidSchema } from '@/lib/validation/common';

export const runtime = 'nodejs';

interface RouteContext {
  params: Promise<{ id: string }>;
}

export async function PATCH(_req: Request, ctx: RouteContext): Promise<Response> {
  const requestId = crypto.randomUUID();
  const log = withRequestId(requestId);
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return unauthenticated();

    const { id } = await ctx.params;
    const parsed = uuidSchema.safeParse(id);
    if (!parsed.success) {
      return validationError([{ path: 'id', message: 'invalid uuid' }]);
    }

    const ended = await endSession(supabase, user.id, parsed.data);
    if (!ended) return notFound();

    const summary = await getSessionTradesSummary(supabase, user.id, parsed.data);

    const body = {
      sessionId: ended.id,
      endedAt: ended.ended_at,
      tradesInSession: summary.tradeCount,
    };
    log.info('session_ended', { sessionId: ended.id, tradesInSession: summary.tradeCount });
    return new Response(JSON.stringify(body), {
      status: 200,
      headers: { 'Content-Type': 'application/json; charset=utf-8' },
    });
  } catch (err) {
    log.error('session_end_failed', {
      message: err instanceof Error ? err.message : String(err),
    });
    return toApiResponse(err, requestId);
  }
}
