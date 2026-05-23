// GET /api/sessions/active — current active session + tilt check info for header.
// Returns `{ activeSession: null }` when none is active.

import { createClient } from '@/lib/supabase/server';
import { toApiResponse, unauthenticated } from '@/lib/utils/api-error';
import { withRequestId } from '@/lib/utils/logger';
import { findActiveSession } from '@/lib/repositories/sessions';
import { findTiltCheckBySession } from '@/lib/repositories/tilt-checks';
import type { ActiveSessionResponse } from '@/types/api';

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

    const active = await findActiveSession(supabase, user.id);
    if (!active) {
      const body: ActiveSessionResponse = { activeSession: null };
      return new Response(JSON.stringify(body), {
        status: 200,
        headers: { 'Content-Type': 'application/json; charset=utf-8' },
      });
    }

    const tilt = await findTiltCheckBySession(supabase, active.id);
    const body: ActiveSessionResponse = {
      activeSession: {
        id: active.id,
        startedAt: active.started_at,
        tiltCheck: tilt ? { color: tilt.tilt_color, submittedAt: tilt.submitted_at } : null,
      },
    };
    log.info('session_active_fetched', { sessionId: active.id, hasTilt: tilt !== null });
    return new Response(JSON.stringify(body), {
      status: 200,
      headers: { 'Content-Type': 'application/json; charset=utf-8' },
    });
  } catch (err) {
    log.error('session_active_failed', {
      message: err instanceof Error ? err.message : String(err),
    });
    return toApiResponse(err, requestId);
  }
}
