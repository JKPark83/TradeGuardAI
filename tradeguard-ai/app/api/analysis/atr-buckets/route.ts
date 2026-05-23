// GET /api/analysis/atr-buckets — performance by ATR volatility bucket (FR-007).
// Buckets: low [0,20), normal [20,40), high [40,∞). Trades without a snapshot fall into "normal".

import { createClient } from '@/lib/supabase/server';
import { toApiResponse, unauthenticated } from '@/lib/utils/api-error';
import { withRequestId } from '@/lib/utils/logger';
import { getAtrBuckets } from '@/lib/repositories/analyses';

export const runtime = 'nodejs';

export async function GET(): Promise<Response> {
  const requestId = crypto.randomUUID();
  const log = withRequestId(requestId);
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return unauthenticated();

    const buckets = await getAtrBuckets(supabase, user.id);
    log.info('atr_buckets_computed');
    return new Response(JSON.stringify({ buckets }), {
      status: 200,
      headers: { 'Content-Type': 'application/json; charset=utf-8' },
    });
  } catch (err) {
    log.error('atr_buckets_failed', {
      message: err instanceof Error ? err.message : String(err),
    });
    return toApiResponse(err, requestId);
  }
}
