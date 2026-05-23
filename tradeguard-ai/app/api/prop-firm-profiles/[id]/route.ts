// PATCH /api/prop-firm-profiles/:id — partial update of a profile.
// DELETE /api/prop-firm-profiles/:id — soft delete (is_active=false).
//
// Contract: see contracts/prop-firm-api.md.

import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { notFound, toApiResponse, unauthenticated, validationError } from '@/lib/utils/api-error';
import { withRequestId } from '@/lib/utils/logger';
import { drawdownTypeSchema, firmNameSchema, uuidSchema } from '@/lib/validation/common';
import { deactivateProfile, getProfile, updateProfile } from '@/lib/repositories/prop-firm';
import { computeRoomForProfile, propFirmProfileToResponse } from '@/lib/services/prop-firm-room';

export const runtime = 'nodejs';

const JSON_HEADERS = { 'Content-Type': 'application/json; charset=utf-8' } as const;

interface RouteContext {
  params: Promise<{ id: string }>;
}

const patchSchema = z
  .object({
    firmName: firmNameSchema.optional(),
    firmLabel: z.string().max(120).nullable().optional(),
    accountSize: z.number().positive().optional(),
    dailyLossLimit: z.number().nonnegative().nullable().optional(),
    drawdownType: drawdownTypeSchema.optional(),
    drawdownLimit: z.number().positive().optional(),
    warnThresholdPct: z.number().gt(0).lt(1).optional(),
    isActive: z.boolean().optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: 'at least one field required' });

export async function PATCH(req: Request, ctx: RouteContext): Promise<Response> {
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

    let rawBody: unknown = {};
    try {
      rawBody = await req.json();
    } catch {
      return validationError([{ path: 'body', message: 'invalid JSON' }]);
    }
    const parsed = patchSchema.safeParse(rawBody);
    if (!parsed.success) {
      return validationError(
        parsed.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
      );
    }

    const existing = await getProfile(supabase, user.id, idParsed.data);
    if (!existing) return notFound();

    const updated = await updateProfile(supabase, user.id, idParsed.data, parsed.data);
    const now = new Date();
    const room = await computeRoomForProfile(supabase, user.id, updated, now);
    const response = propFirmProfileToResponse(updated, room, now.toISOString());

    log.info('prop_firm_profile_updated', { profileId: updated.id });
    return new Response(JSON.stringify(response), { status: 200, headers: JSON_HEADERS });
  } catch (err) {
    log.error('prop_firm_profile_patch_failed', {
      message: err instanceof Error ? err.message : String(err),
    });
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
    const idParsed = uuidSchema.safeParse(id);
    if (!idParsed.success) {
      return validationError([{ path: 'id', message: 'invalid uuid' }]);
    }

    const existing = await getProfile(supabase, user.id, idParsed.data);
    if (!existing) return notFound();

    await deactivateProfile(supabase, user.id, idParsed.data);
    log.info('prop_firm_profile_deactivated', { profileId: idParsed.data });
    return new Response(null, { status: 204 });
  } catch (err) {
    log.error('prop_firm_profile_delete_failed', {
      message: err instanceof Error ? err.message : String(err),
    });
    return toApiResponse(err, requestId);
  }
}
