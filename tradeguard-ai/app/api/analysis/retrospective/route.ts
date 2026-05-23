// POST /api/analysis/retrospective — generate (or regenerate) an AI 회고.
// Contract: contracts/analysis-api.md#post-apianalysisretrospective.
//
// Body shape:
//   - { tradeId }                    → single-trade retrospective
//   - { periodFrom, periodTo }       → period (e.g. weekly) retrospective
//   - { regenerate: true }           → force a fresh LLM call (ignored at this
//                                      layer; service appends a new row regardless)
//
// Tone-filter failure (3 consecutive warmth detections) maps to 422 with the
// `RetrospectiveFailure` body, per the contract.

import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { ApiError, toApiResponse, unauthenticated, validationError } from '@/lib/utils/api-error';
import { withRequestId } from '@/lib/utils/logger';
import { generateRetrospective } from '@/lib/services/retrospective';
import { uuidSchema } from '@/lib/validation/common';

const dateSchema = z.string().refine((s) => !Number.isNaN(Date.parse(s)), {
  message: 'must be a valid ISO date or datetime string',
});

const bodySchema = z
  .object({
    tradeId: uuidSchema.optional(),
    periodFrom: dateSchema.optional(),
    periodTo: dateSchema.optional(),
    regenerate: z.boolean().optional(),
  })
  .strict()
  .refine((v) => Boolean(v.tradeId) || (Boolean(v.periodFrom) && Boolean(v.periodTo)), {
    message: 'either tradeId or (periodFrom + periodTo) is required',
  });

export const runtime = 'nodejs';

const JSON_HEADERS = { 'Content-Type': 'application/json; charset=utf-8' } as const;

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
      json = {};
    }
    const parsed = bodySchema.safeParse(json);
    if (!parsed.success) {
      return validationError(
        parsed.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
      );
    }

    const period =
      parsed.data.periodFrom && parsed.data.periodTo
        ? { from: parsed.data.periodFrom, to: parsed.data.periodTo }
        : undefined;

    const result = await generateRetrospective({
      supabase,
      ownerId: user.id,
      tradeId: parsed.data.tradeId,
      period,
    });

    if ('error' in result) {
      log.warn('retrospective_tone_filter_failed', {
        attemptsUsed: result.attemptsUsed,
      });
      return new Response(JSON.stringify(result), { status: 422, headers: JSON_HEADERS });
    }

    log.info('retrospective_generated', {
      analysisId: result.analysisId,
      tokenUsage: result.tokenUsage,
    });
    return new Response(JSON.stringify(result), { status: 200, headers: JSON_HEADERS });
  } catch (err) {
    log.error('retrospective_route_failed', {
      message: err instanceof Error ? err.message : String(err),
    });
    if (err instanceof ApiError) return err.toResponse();
    return toApiResponse(err, requestId);
  }
}
