// AI 회고 생성 서비스 (US2).
//
// Pipeline:
//   1. Fetch the per-user HMAC secret (`user_secrets.pii_hmac_secret`)
//   2. Load the target trade(s) — single by ID, or all within a date range
//   3. Anonymize via `anonymizeTrade` (PII tokenization)
//   4. Compose the Korean prompt (system + user)
//   5. Call Claude Sonnet 4.6 via `LlmClient`
//   6. Run the warmth-expression filter (research.md#R-09)
//   7. On filter failure: append a stronger negative example and retry,
//      up to MAX_ATTEMPTS total. All 3 failures → persist `filtered_out`
//      and return a `RetrospectiveFailure` for the route to surface 422.
//   8. On success: persist a fresh `analyses` row (input_snapshot +
//      token_usage saved for FR-018 reproducibility).
//
// The LlmClient is injected so tests can substitute a deterministic stub
// — no MSW network plumbing required for the unit-style integration tests.

import type { SupabaseClient } from '@supabase/supabase-js';
import type { Analysis, Trade, UUID } from '@/types/db';
import type { RetrospectiveResponse } from '@/types/api';
import { anonymizeTrade } from '@/lib/llm/anonymize';
import { createLlmClient } from '@/lib/llm/client';
import type { LlmClient, LlmMessageResult } from '@/lib/llm/client';
import { containsWarmthExpression } from '@/lib/llm/filter';
import {
  RETROSPECTIVE_SYSTEM_PROMPT,
  RETROSPECTIVE_USER_TEMPLATE,
  type RetrospectiveInput,
} from '@/lib/llm/prompts';
import { insertAnalysisBatch } from '@/lib/repositories/analyses';
import { getAllTradesForOwner, getTradeById, getTradesByIds } from '@/lib/repositories/trades';
import { logger } from '@/lib/utils/logger';

const MAX_ATTEMPTS = 3;

const RETRY_REINFORCEMENTS: string[] = [
  '',
  '직전 응답에 위로 표현(예: "괜찮", "다음에 잘", "잘했")이 검출되었습니다. 패턴 분석 문장만 출력하십시오.',
  '재차 위로 표현이 검출되었습니다. 출력은 사실·확률·패턴 비교만 포함해야 하며, 어떤 형태의 격려·공감·응원도 금지됩니다.',
];

export interface GenerateRetrospectiveParams {
  supabase: SupabaseClient;
  ownerId: UUID;
  tradeId?: UUID;
  period?: { from: string; to: string };
  /** Inject a stub in tests; defaults to a fresh `LlmClient()`. */
  llmClient?: Pick<LlmClient, 'messages'>;
}

export interface RetrospectiveFailure {
  error: 'tone_filter_failed';
  attemptsUsed: number;
  lastOutputBlocked: string;
}

export async function generateRetrospective(
  params: GenerateRetrospectiveParams,
): Promise<RetrospectiveResponse | RetrospectiveFailure> {
  const { supabase, ownerId, tradeId, period } = params;
  if (!tradeId && !period) {
    throw new Error('generateRetrospective: tradeId or period is required');
  }

  // 1. Fetch user secret (required for deterministic PII tokenization).
  const userSecret = await fetchUserSecret(supabase, ownerId);

  // 2. Resolve target trade(s).
  const { focalTrade, relatedTrades } = await loadTrades({ supabase, ownerId, tradeId, period });

  // 3. Anonymize.
  const anonFocal = anonymizeTrade(focalTrade, userSecret);
  const anonRelated = relatedTrades.map((t) => anonymizeTrade(t, userSecret));

  // 4. Build prompt input.
  const baseInput: RetrospectiveInput = {
    trade: anonFocal,
    scores: { stopDelayScore: null, revengeScore: null, overconfidenceScore: null },
    marketContext: null,
    priorWarningRaised: false,
    relatedTrades: anonRelated.length > 0 ? anonRelated : undefined,
  };

  const llm = params.llmClient ?? createLlmClient();

  // 5-7. Call LLM with up to MAX_ATTEMPTS attempts, applying the warmth filter
  //       between each attempt and reinforcing the negative example on retry.
  let lastResult: LlmMessageResult | null = null;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    const promptInput: RetrospectiveInput = {
      ...baseInput,
      retryReinforcement: attempt > 1 ? RETRY_REINFORCEMENTS[attempt - 1] : undefined,
    };
    const userMessage = RETRSPECTIVE_USER_PROMPT(promptInput);

    try {
      lastResult = await llm.messages({
        systemPrompt: RETROSPECTIVE_SYSTEM_PROMPT,
        userMessage,
        maxTokens: 1024,
      });
    } catch (err) {
      logger.error('retrospective_llm_call_failed', {
        ownerId,
        attempt,
        message: err instanceof Error ? err.message : String(err),
      });
      throw err;
    }

    if (!containsWarmthExpression(lastResult.text)) {
      const inserted = await persistAnalysis({
        supabase,
        ownerId,
        tradeId: focalTrade.id,
        status: 'generated',
        text: lastResult.text,
        inputSnapshot: buildInputSnapshot({ tradeId: focalTrade.id, period, attempt }),
        tokenUsage: lastResult.tokenUsage,
      });

      return {
        analysisId: inserted.id,
        retrospectiveText: lastResult.text,
        filterPassed: true,
        tokenUsage: lastResult.tokenUsage,
        inputSnapshot: buildResponseSnapshot({ tradeId: focalTrade.id, period }),
        status: 'generated',
      };
    }

    logger.warn('retrospective_warmth_detected', {
      ownerId,
      attempt,
      tradeId: focalTrade.id,
    });
  }

  // 8. All attempts failed the filter. Persist filtered_out for reproducibility.
  const lastText = lastResult?.text ?? '';
  const lastUsage = lastResult?.tokenUsage ?? { input: 0, output: 0, model: 'unknown' };
  await persistAnalysis({
    supabase,
    ownerId,
    tradeId: focalTrade.id,
    status: 'filtered_out',
    text: lastText,
    inputSnapshot: buildInputSnapshot({
      tradeId: focalTrade.id,
      period,
      attempt: MAX_ATTEMPTS,
      filterFailed: true,
    }),
    tokenUsage: lastUsage,
  });

  return {
    error: 'tone_filter_failed',
    attemptsUsed: MAX_ATTEMPTS,
    lastOutputBlocked: lastText,
  };
}

// Aliased to keep call sites readable; the template function name is verbose.
const RETRSPECTIVE_USER_PROMPT = RETROSPECTIVE_USER_TEMPLATE;

async function fetchUserSecret(supabase: SupabaseClient, ownerId: UUID): Promise<string> {
  const { data, error } = await supabase
    .from('user_secrets')
    .select('pii_hmac_secret')
    .eq('user_id', ownerId)
    .maybeSingle<{ pii_hmac_secret: string }>();
  if (error) {
    logger.error('retrospective_user_secret_query_failed', {
      ownerId,
      message: error.message,
    });
    throw new Error('generateRetrospective: failed to load user secret');
  }
  if (!data) {
    throw new Error('generateRetrospective: user_secret missing for owner');
  }
  return data.pii_hmac_secret;
}

interface LoadedTrades {
  focalTrade: Trade;
  relatedTrades: Trade[];
}

async function loadTrades(args: {
  supabase: SupabaseClient;
  ownerId: UUID;
  tradeId?: UUID;
  period?: { from: string; to: string };
}): Promise<LoadedTrades> {
  const { supabase, ownerId, tradeId, period } = args;

  if (tradeId) {
    const detail = await getTradeById(supabase, ownerId, tradeId);
    if (!detail) {
      throw new Error('generateRetrospective: trade not found');
    }
    // getTradeById returns a TradeDetail wrapper; we need the raw Trade row.
    const [raw] = await getTradesByIds(supabase, ownerId, [tradeId]);
    if (!raw) {
      throw new Error('generateRetrospective: trade row missing after detail lookup');
    }
    return { focalTrade: raw, relatedTrades: [] };
  }

  // Period mode: pick the most-recent trade in the window as focal,
  // pass the rest as related context.
  const all = await getAllTradesForOwner(supabase, ownerId);
  const inWindow = all.filter((t) => {
    if (period && (t.entry_at < period.from || t.entry_at > period.to)) return false;
    return true;
  });
  if (inWindow.length === 0) {
    throw new Error('generateRetrospective: no trades in selected period');
  }
  const sorted = [...inWindow].sort((a, b) => b.entry_at.localeCompare(a.entry_at));
  const [focal, ...rest] = sorted;
  return { focalTrade: focal, relatedTrades: rest };
}

interface PersistAnalysisArgs {
  supabase: SupabaseClient;
  ownerId: UUID;
  tradeId: UUID;
  status: Analysis['retrospective_status'];
  text: string;
  inputSnapshot: Record<string, unknown>;
  tokenUsage: { input: number; output: number; model: string };
}

async function persistAnalysis(args: PersistAnalysisArgs): Promise<Analysis> {
  const [row] = await insertAnalysisBatch(args.supabase, args.ownerId, [
    {
      trade_id: args.tradeId,
      stop_delay_score: null,
      revenge_score: null,
      overconfidence_score: null,
      retrospective_text: args.status === 'filtered_out' ? null : args.text,
      retrospective_status: args.status,
      llm_input_snapshot: args.inputSnapshot,
      llm_token_usage: args.tokenUsage,
    },
  ]);
  if (!row) {
    throw new Error('generateRetrospective: failed to persist analyses row');
  }
  return row;
}

function buildInputSnapshot(args: {
  tradeId: UUID;
  period?: { from: string; to: string };
  attempt: number;
  filterFailed?: boolean;
}): Record<string, unknown> {
  return {
    tradeId: args.tradeId,
    period: args.period ?? null,
    attempt: args.attempt,
    anonymized: true,
    filterFailed: args.filterFailed ?? false,
  };
}

function buildResponseSnapshot(args: {
  tradeId: UUID;
  period?: { from: string; to: string };
}): RetrospectiveResponse['inputSnapshot'] {
  return args.period
    ? { tradeId: args.tradeId, period: args.period, anonymized: true }
    : { tradeId: args.tradeId, anonymized: true };
}
