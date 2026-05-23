// POST /api/sessions/:id/tilt — register pre-session mental check-in.
// One check-in per session (DB UNIQUE on session_id). Re-submit returns 409
// with the existing tilt info so the client can render it without re-querying.

import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { toApiResponse, unauthenticated, validationError } from '@/lib/utils/api-error';
import { withRequestId } from '@/lib/utils/logger';
import { uuidSchema } from '@/lib/validation/common';
import { computeTiltScore, tiltRecommendations } from '@/lib/scoring/tilt';
import {
  findTiltCheckBySession,
  insertTiltCheck,
  TiltAlreadySubmittedError,
} from '@/lib/repositories/tilt-checks';
import type { TiltSubmitResponse } from '@/types/api';

const bodySchema = z.object({
  sleepScore: z.number().int().min(1).max(10),
  stressScore: z.number().int().min(1).max(10),
  externalEvent: z.string().max(500).nullable().optional(),
  externalEventSerious: z.boolean().optional(),
});

export const runtime = 'nodejs';

interface RouteContext {
  params: Promise<{ id: string }>;
}

export async function POST(req: Request, ctx: RouteContext): Promise<Response> {
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

    let raw: unknown = {};
    try {
      raw = await req.json();
    } catch {
      return validationError([{ path: 'body', message: 'invalid JSON' }]);
    }
    const parsed = bodySchema.safeParse(raw);
    if (!parsed.success) {
      return validationError(
        parsed.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
      );
    }

    const {
      sleepScore,
      stressScore,
      externalEvent = null,
      externalEventSerious = false,
    } = parsed.data;

    const { color, rawScore } = computeTiltScore({
      sleepScore,
      stressScore,
      externalEventSerious,
    });

    try {
      const inserted = await insertTiltCheck(supabase, user.id, idParsed.data, {
        sleepScore,
        stressScore,
        externalEvent: externalEvent ?? null,
        externalEventSerious,
        tiltColor: color,
        rawScore,
      });

      const body: TiltSubmitResponse = {
        tiltCheckId: inserted.id,
        tiltColor: inserted.tilt_color,
        rawScore: Number(inserted.raw_score),
        recommendations: tiltRecommendations(inserted.tilt_color),
        submittedAt: inserted.submitted_at,
      };
      log.info('tilt_submitted', {
        sessionId: idParsed.data,
        color: inserted.tilt_color,
      });
      return new Response(JSON.stringify(body), {
        status: 201,
        headers: { 'Content-Type': 'application/json; charset=utf-8' },
      });
    } catch (err) {
      if (err instanceof TiltAlreadySubmittedError) {
        const existing = await findTiltCheckBySession(supabase, idParsed.data);
        const existingBody = existing
          ? {
              tiltCheckId: existing.id,
              tiltColor: existing.tilt_color,
              rawScore: Number(existing.raw_score),
              submittedAt: existing.submitted_at,
            }
          : null;
        log.warn('tilt_already_submitted', { sessionId: idParsed.data });
        return new Response(
          JSON.stringify({ error: 'tilt_already_submitted', existing: existingBody }),
          { status: 409, headers: { 'Content-Type': 'application/json; charset=utf-8' } },
        );
      }
      throw err;
    }
  } catch (err) {
    log.error('tilt_submit_failed', {
      message: err instanceof Error ? err.message : String(err),
    });
    return toApiResponse(err, requestId);
  }
}
