// POST /api/sessions — create new trading session, or return existing active one.
// Body: { force?: boolean }. With `force=true`, the active session is ended first
// before creating a fresh one. Without `force`, an existing active session is
// returned with status 200 (per contract sessions-api.md).

import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { toApiResponse, unauthenticated, validationError } from '@/lib/utils/api-error';
import { withRequestId } from '@/lib/utils/logger';
import { createSession, endSession, findActiveSession } from '@/lib/repositories/sessions';
import { findTiltCheckBySession } from '@/lib/repositories/tilt-checks';
import type { TiltColor } from '@/types/db';

const bodySchema = z.object({
  force: z.boolean().optional(),
});

export const runtime = 'nodejs';

interface TiltCheckSummary {
  color: TiltColor;
  submittedAt: string;
}

interface SessionResult {
  sessionId: string;
  startedAt: string;
  tiltCheck: TiltCheckSummary | null;
}

export async function POST(req: Request): Promise<Response> {
  const requestId = crypto.randomUUID();
  const log = withRequestId(requestId);
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return unauthenticated();

    // Body is optional; default to empty object.
    let rawBody: unknown = {};
    const contentType = req.headers.get('content-type') ?? '';
    if (contentType.includes('application/json')) {
      try {
        rawBody = await req.json();
      } catch {
        rawBody = {};
      }
    }
    const parsed = bodySchema.safeParse(rawBody);
    if (!parsed.success) {
      return validationError(
        parsed.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
      );
    }
    const { force } = parsed.data;

    const existing = await findActiveSession(supabase, user.id);

    if (existing && !force) {
      const tilt = await findTiltCheckBySession(supabase, existing.id);
      const payload: SessionResult = {
        sessionId: existing.id,
        startedAt: existing.started_at,
        tiltCheck: tilt ? { color: tilt.tilt_color, submittedAt: tilt.submitted_at } : null,
      };
      log.info('session_existing_returned', { sessionId: existing.id });
      return new Response(JSON.stringify(payload), {
        status: 200,
        headers: { 'Content-Type': 'application/json; charset=utf-8' },
      });
    }

    if (existing && force) {
      await endSession(supabase, user.id, existing.id);
      log.info('session_force_ended', { sessionId: existing.id });
    }

    const created = await createSession(supabase, user.id);
    const payload: SessionResult = {
      sessionId: created.id,
      startedAt: created.started_at,
      tiltCheck: null,
    };
    log.info('session_created', { sessionId: created.id });
    return new Response(JSON.stringify(payload), {
      status: 201,
      headers: { 'Content-Type': 'application/json; charset=utf-8' },
    });
  } catch (err) {
    log.error('session_create_failed', {
      message: err instanceof Error ? err.message : String(err),
    });
    return toApiResponse(err, requestId);
  }
}
