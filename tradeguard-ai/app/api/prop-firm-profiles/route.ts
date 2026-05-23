// POST /api/prop-firm-profiles — register a new funded-account ruleset.
// GET  /api/prop-firm-profiles — list active profiles + live currentRoom.
//
// Contract: see contracts/prop-firm-api.md.

import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { toApiResponse, unauthenticated, validationError } from '@/lib/utils/api-error';
import { withRequestId } from '@/lib/utils/logger';
import { drawdownTypeSchema, firmNameSchema } from '@/lib/validation/common';
import { createProfile } from '@/lib/repositories/prop-firm';
import {
  computeRoomForProfile,
  getRoomsForUser,
  propFirmProfileToResponse,
} from '@/lib/services/prop-firm-room';
import type { PropFirmProfileResponse } from '@/types/api';

export const runtime = 'nodejs';

const JSON_HEADERS = { 'Content-Type': 'application/json; charset=utf-8' } as const;

const createSchema = z.object({
  firmName: firmNameSchema,
  firmLabel: z.string().max(120).optional(),
  accountSize: z.number().positive(),
  dailyLossLimit: z.number().nonnegative().nullable().optional(),
  drawdownType: drawdownTypeSchema,
  drawdownLimit: z.number().positive(),
  warnThresholdPct: z.number().gt(0).lt(1).optional(),
});

export async function POST(req: Request): Promise<Response> {
  const requestId = crypto.randomUUID();
  const log = withRequestId(requestId);
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return unauthenticated();

    let rawBody: unknown = {};
    try {
      rawBody = await req.json();
    } catch {
      return validationError([{ path: 'body', message: 'invalid JSON' }]);
    }
    const parsed = createSchema.safeParse(rawBody);
    if (!parsed.success) {
      return validationError(
        parsed.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
      );
    }

    const profile = await createProfile(supabase, user.id, parsed.data);
    const now = new Date();
    const room = await computeRoomForProfile(supabase, user.id, profile, now);
    const response = propFirmProfileToResponse(profile, room, now.toISOString());

    log.info('prop_firm_profile_created', { profileId: profile.id, firm: profile.firm_name });
    return new Response(JSON.stringify(response), { status: 201, headers: JSON_HEADERS });
  } catch (err) {
    log.error('prop_firm_profile_create_failed', {
      message: err instanceof Error ? err.message : String(err),
    });
    return toApiResponse(err, requestId);
  }
}

export async function GET(): Promise<Response> {
  const requestId = crypto.randomUUID();
  const log = withRequestId(requestId);
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return unauthenticated();

    const profiles = await getRoomsForUser(supabase, user.id);
    const body: { profiles: PropFirmProfileResponse[] } = { profiles };
    log.info('prop_firm_profiles_listed', { count: profiles.length });
    return new Response(JSON.stringify(body), { status: 200, headers: JSON_HEADERS });
  } catch (err) {
    log.error('prop_firm_profiles_list_failed', {
      message: err instanceof Error ? err.message : String(err),
    });
    return toApiResponse(err, requestId);
  }
}
