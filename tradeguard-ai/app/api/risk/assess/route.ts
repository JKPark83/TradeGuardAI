// POST /api/risk/assess — real-time entry risk evaluation.
// Contract: contracts/risk-api.md#post-apiriskassess.
//
// SLA: p95 ≤ 5 s (SC-004). The service layer enforces a 3 s timeout on the
// optional LLM explanation via `Promise.race`; scoring itself is sync math
// completing in well under 500 ms even on thousands of historical trades.

import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { ApiError, toApiResponse, unauthenticated, validationError } from '@/lib/utils/api-error';
import { withRequestId } from '@/lib/utils/logger';
import { assessRisk } from '@/lib/services/risk-assessment';
import { tradeSideSchema } from '@/lib/validation/common';

export const runtime = 'nodejs';

const JSON_HEADERS = { 'Content-Type': 'application/json; charset=utf-8' } as const;

const bodySchema = z
  .object({
    candidateSymbol: z.string().min(1).max(32),
    candidateSide: tradeSideSchema,
    candidateContracts: z.number().positive().max(10_000).optional(),
    includeLLMExplanation: z.boolean().optional(),
  })
  .strict();

export async function POST(req: Request): Promise<Response> {
  const requestId = crypto.randomUUID();
  const log = withRequestId(requestId);
  const startedAt = Date.now();

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

    const response = await assessRisk({
      supabase,
      ownerId: user.id,
      candidate: {
        symbol: parsed.data.candidateSymbol,
        side: parsed.data.candidateSide,
        contracts: parsed.data.candidateContracts ?? null,
      },
      includeLLMExplanation: parsed.data.includeLLMExplanation ?? false,
    });

    const durationMs = Date.now() - startedAt;
    log.info('risk_assessed', {
      assessmentId: response.assessmentId,
      riskScore: response.riskScore,
      durationMs,
    });

    return new Response(JSON.stringify(response), { status: 200, headers: JSON_HEADERS });
  } catch (err) {
    log.error('risk_assess_failed', {
      message: err instanceof Error ? err.message : String(err),
    });
    if (err instanceof ApiError) return err.toResponse();
    return toApiResponse(err, requestId);
  }
}
