// GET /api/trades/:id — single trade with analyses + market snapshot.
// DELETE /api/trades/:id — owner-scoped soft delete (we use hard delete; cascades remove analyses).

import { createClient } from '@/lib/supabase/server';
import { notFound, toApiResponse, unauthenticated, validationError } from '@/lib/utils/api-error';
import { withRequestId } from '@/lib/utils/logger';
import { deleteTrade, getTradeById } from '@/lib/repositories/trades';
import { uuidSchema } from '@/lib/validation/common';

export const runtime = 'nodejs';

interface RouteContext {
  params: Promise<{ id: string }>;
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

    const { id } = await ctx.params;
    const parsed = uuidSchema.safeParse(id);
    if (!parsed.success) {
      return validationError([{ path: 'id', message: 'invalid uuid' }]);
    }

    const detail = await getTradeById(supabase, user.id, parsed.data);
    if (!detail) return notFound();
    log.info('trade_fetched', { tradeId: parsed.data });
    return new Response(JSON.stringify(detail), {
      status: 200,
      headers: { 'Content-Type': 'application/json; charset=utf-8' },
    });
  } catch (err) {
    log.error('trade_get_failed', { message: err instanceof Error ? err.message : String(err) });
    return toApiResponse(err, requestId);
  }
}

export async function DELETE(_req: Request, ctx: RouteContext): Promise<Response> {
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

    const deleted = await deleteTrade(supabase, user.id, parsed.data);
    if (!deleted) return notFound();
    log.info('trade_deleted', { tradeId: parsed.data });
    return new Response(null, { status: 204 });
  } catch (err) {
    log.error('trade_delete_failed', {
      message: err instanceof Error ? err.message : String(err),
    });
    return toApiResponse(err, requestId);
  }
}
