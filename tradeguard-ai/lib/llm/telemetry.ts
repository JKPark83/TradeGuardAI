// LLM telemetry — record per-call token usage + latency + estimated cost to
// the `llm_calls` table so the cost-guard (lib/llm/cost-guard.ts) can read
// daily totals and the dashboard can surface spend.
//
// This module is deliberately fire-and-forget: a logging failure never breaks
// the LLM call itself. Writes are best-effort; if Supabase is unreachable we
// log a warning and move on.

import type { SupabaseClient } from '@supabase/supabase-js';
import type { LlmProvider, LlmTokenUsage } from '@/lib/llm/client';
import { logger } from '@/lib/utils/logger';

export type LlmCallPurpose = 'retrospective' | 'risk_explanation' | 'other';

// USD per 1M tokens — order-of-magnitude rates published by Anthropic/OpenAI
// as of 2026-05. These are intentionally conservative (slight over-estimate)
// so the cost guard errs on the side of safety. Keep in sync with model
// pricing updates.
const PRICING_PER_MTOK: Record<string, { input: number; output: number }> = {
  // Claude
  'claude-sonnet-4-6': { input: 3.0, output: 15.0 },
  'claude-haiku-4-5-20251001': { input: 0.8, output: 4.0 },
  // OpenAI
  'gpt-4o-2024-08-06': { input: 2.5, output: 10.0 },
  'gpt-4o-mini': { input: 0.15, output: 0.6 },
};

/** Default fallback rate when the model is unknown (assumes top-tier pricing). */
const FALLBACK_RATE = { input: 5.0, output: 20.0 };

export function estimateCostUsd(usage: LlmTokenUsage): number {
  const rate = PRICING_PER_MTOK[usage.model] ?? FALLBACK_RATE;
  const inputCost = (usage.input / 1_000_000) * rate.input;
  const outputCost = (usage.output / 1_000_000) * rate.output;
  // NUMERIC(10,6) in DB — clamp to 6 decimals at write time.
  return Math.round((inputCost + outputCost) * 1_000_000) / 1_000_000;
}

export interface LlmCallRecordInput {
  ownerId: string;
  provider: LlmProvider;
  purpose: LlmCallPurpose;
  usage: LlmTokenUsage;
  latencyMs: number;
  ok: boolean;
  errorCode?: string;
}

/** Persist one row to `llm_calls`. Never throws. */
export async function recordLlmCall(
  supabase: SupabaseClient,
  input: LlmCallRecordInput,
): Promise<void> {
  try {
    const cost = estimateCostUsd(input.usage);
    const { error } = await supabase.from('llm_calls').insert({
      owner_id: input.ownerId,
      provider: input.provider,
      model: input.usage.model,
      purpose: input.purpose,
      input_tokens: input.usage.input,
      output_tokens: input.usage.output,
      cost_usd: cost,
      latency_ms: input.latencyMs,
      ok: input.ok,
      error_code: input.errorCode ?? null,
    });
    if (error) {
      logger.warn('llm_telemetry_insert_failed', { message: error.message });
    }
  } catch (err) {
    logger.warn('llm_telemetry_unexpected', {
      message: err instanceof Error ? err.message : String(err),
    });
  }
}

/**
 * Wraps an LLM call with timing + telemetry. Caller passes the raw async
 * function plus identifying metadata; we record success/failure and return
 * the original result (or re-throw the original error after logging).
 */
export async function withTelemetry<T extends { tokenUsage: LlmTokenUsage }>(
  supabase: SupabaseClient,
  meta: { ownerId: string; provider: LlmProvider; purpose: LlmCallPurpose },
  fn: () => Promise<T>,
): Promise<T> {
  const startedAt = Date.now();
  try {
    const result = await fn();
    const latencyMs = Date.now() - startedAt;
    void recordLlmCall(supabase, {
      ownerId: meta.ownerId,
      provider: meta.provider,
      purpose: meta.purpose,
      usage: result.tokenUsage,
      latencyMs,
      ok: true,
    });
    return result;
  } catch (err) {
    const latencyMs = Date.now() - startedAt;
    void recordLlmCall(supabase, {
      ownerId: meta.ownerId,
      provider: meta.provider,
      purpose: meta.purpose,
      usage: { input: 0, output: 0, model: 'unknown' },
      latencyMs,
      ok: false,
      errorCode: classifyError(err),
    });
    throw err;
  }
}

/** Extract a short, non-PII error code from any thrown value. */
function classifyError(err: unknown): string {
  if (err instanceof Error) {
    // First word of the error name/message gives us "TimeoutError",
    // "AuthenticationError", "RateLimitError", etc. without leaking detail.
    const candidate = err.name && err.name !== 'Error' ? err.name : err.message.split(' ')[0];
    return candidate.slice(0, 64);
  }
  return 'unknown';
}
