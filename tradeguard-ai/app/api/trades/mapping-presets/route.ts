// GET /api/trades/mapping-presets — system seeds + owner customs.
// POST /api/trades/mapping-presets — create a custom preset.

import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { toApiResponse, unauthenticated, validationError } from '@/lib/utils/api-error';
import { withRequestId } from '@/lib/utils/logger';
import { createPreset, listPresets } from '@/lib/repositories/mapping-presets';

const createSchema = z.object({
  name: z.string().min(1).max(64),
  columnMapping: z.record(z.string(), z.string()),
  timeFormat: z.string().min(1).max(64),
  pnlSignConvention: z.enum(['broker_native', 'computed']).default('broker_native'),
  headerSignature: z.array(z.string()).default([]),
});

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
    const rows = await listPresets(supabase, user.id);
    const body = {
      presets: rows.map((p) => ({
        id: p.id,
        name: p.preset_name,
        isSystem: p.owner_id === null,
        headerSignature: p.header_signature,
      })),
    };
    log.info('presets_listed', { count: rows.length });
    return new Response(JSON.stringify(body), {
      status: 200,
      headers: { 'Content-Type': 'application/json; charset=utf-8' },
    });
  } catch (err) {
    log.error('presets_list_failed', {
      message: err instanceof Error ? err.message : String(err),
    });
    return toApiResponse(err, requestId);
  }
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

    let json: unknown;
    try {
      json = await req.json();
    } catch {
      return validationError([{ path: 'body', message: 'invalid JSON' }]);
    }
    const parsed = createSchema.safeParse(json);
    if (!parsed.success) {
      return validationError(
        parsed.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
      );
    }
    const dto = parsed.data;
    const created = await createPreset(supabase, user.id, {
      preset_name: dto.name,
      header_signature: dto.headerSignature,
      column_mapping: dto.columnMapping,
      time_format: dto.timeFormat,
      pnl_sign_convention: dto.pnlSignConvention,
    });
    log.info('preset_created', { id: created.id });
    return new Response(JSON.stringify({ id: created.id }), {
      status: 201,
      headers: { 'Content-Type': 'application/json; charset=utf-8' },
    });
  } catch (err) {
    log.error('preset_create_failed', {
      message: err instanceof Error ? err.message : String(err),
    });
    return toApiResponse(err, requestId);
  }
}
