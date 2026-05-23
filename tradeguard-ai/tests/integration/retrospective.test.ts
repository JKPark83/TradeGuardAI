/**
 * Integration test for lib/services/retrospective.ts.
 *
 * We mock:
 *   - Supabase: a hand-rolled chainable stub returning user_secrets + trades
 *     + accepting an analyses insert.
 *   - LlmClient: a thin stub whose `.messages()` is sequenced per test case.
 *
 * MSW handlers (tests/mocks/handlers.ts) cover Anthropic at the HTTP layer,
 * so a "real-ish" call path would also be possible. For determinism and
 * speed we drive the LlmClient seam directly here.
 */

import { describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { generateRetrospective } from '@/lib/services/retrospective';
import type { LlmClient, LlmMessageResult } from '@/lib/llm/client';
import type { Trade } from '@/types/db';

const OWNER_ID = '00000000-0000-0000-0000-000000000aaa';
const TRADE_ID = '00000000-0000-0000-0000-000000000bbb';
const USER_SECRET = 'integration-test-secret-do-not-use';

function buildTrade(overrides: Partial<Trade> = {}): Trade {
  return {
    id: TRADE_ID,
    owner_id: OWNER_ID,
    session_id: null,
    symbol: 'NQ',
    side: 'long',
    entry_price: '20000',
    exit_price: '19950',
    entry_at: '2026-05-23T13:30:00Z',
    exit_at: '2026-05-23T14:00:00Z',
    pnl: '-50.00',
    contracts: '2',
    source_csv_id: null,
    source_row: null,
    created_at: '2026-05-23T13:30:00Z',
    ...overrides,
  };
}

interface InsertedAnalysis {
  id: string;
  trade_id: string;
  owner_id: string;
  retrospective_status: string;
  retrospective_text: string | null;
  llm_input_snapshot: Record<string, unknown> | null;
  llm_token_usage: { input: number; output: number; model: string } | null;
}

interface SupabaseStubResult {
  client: SupabaseClient;
  inserted: InsertedAnalysis[];
}

/**
 * Build a minimal Supabase stub that responds to the three queries the
 * service performs (user_secrets select, trades select for getTradeById +
 * getTradesByIds + getAllTradesForOwner, analyses insert).
 */
function buildSupabaseStub(trades: Trade[]): SupabaseStubResult {
  const inserted: InsertedAnalysis[] = [];

  const fromImpl = (table: string): unknown => {
    if (table === 'user_secrets') {
      return makeUserSecretsBuilder();
    }
    if (table === 'trades') {
      return makeTradesBuilder(trades);
    }
    if (table === 'analyses') {
      return makeAnalysesBuilder(inserted);
    }
    if (table === 'market_snapshots') {
      return makeEmptySelectBuilder();
    }
    throw new Error(`unexpected table: ${table}`);
  };

  const client = { from: vi.fn(fromImpl) } as unknown as SupabaseClient;
  return { client, inserted };
}

function makeUserSecretsBuilder() {
  return {
    select: () => ({
      eq: () => ({
        maybeSingle: async () => ({ data: { pii_hmac_secret: USER_SECRET }, error: null }),
      }),
    }),
  };
}

function makeTradesBuilder(trades: Trade[]) {
  // Supports: .select('*').eq('owner_id', x).eq('id', y).maybeSingle()
  //           .select('*').eq('owner_id', x).in('id', [...])
  //           .select('*').eq('owner_id', x).order(...)
  let filterId: string | null = null;
  let filterIds: string[] | null = null;

  const builder = {
    select: () => builder,
    eq: (col: string, val: string) => {
      if (col === 'id') filterId = val;
      return builder;
    },
    in: (_col: string, vals: string[]) => {
      filterIds = vals;
      return builder;
    },
    order: () => Promise.resolve({ data: trades, error: null }),
    maybeSingle: async () => {
      const match = trades.find((t) => t.id === filterId) ?? null;
      return { data: match, error: null };
    },
    then: (resolve: (v: { data: Trade[]; error: null }) => void) => {
      // Final-await on `.in()` chain (getTradesByIds path).
      const filtered = filterIds ? trades.filter((t) => filterIds!.includes(t.id)) : trades;
      resolve({ data: filtered, error: null });
    },
  };
  return builder;
}

function makeEmptySelectBuilder() {
  // market_snapshots: getTradeById awaits a maybeSingle().
  return {
    select: () => ({
      eq: () => ({
        maybeSingle: async () => ({ data: null, error: null }),
      }),
    }),
  };
}

function makeAnalysesBuilder(sink: InsertedAnalysis[]) {
  return {
    select: () => ({
      eq: () => ({
        order: () => Promise.resolve({ data: [], error: null }),
      }),
      in: () => Promise.resolve({ data: [], error: null }),
    }),
    insert: (rows: Omit<InsertedAnalysis, 'id'>[]) => ({
      select: () => ({
        // insertAnalysisBatch awaits the chain directly (no .single()).
        then: (resolve: (v: { data: InsertedAnalysis[]; error: null }) => void) => {
          const stamped = rows.map((r, i) => ({
            ...r,
            id: `analysis-${sink.length + i + 1}`,
          })) as InsertedAnalysis[];
          sink.push(...stamped);
          resolve({ data: stamped, error: null });
        },
      }),
    }),
  };
}

function makeLlmStub(sequence: string[]): {
  client: Pick<LlmClient, 'messages'>;
  calls: number;
} {
  let i = 0;
  const meta = { calls: 0 };
  const client: Pick<LlmClient, 'messages'> = {
    messages: vi.fn(async (): Promise<LlmMessageResult> => {
      meta.calls += 1;
      const text = sequence[Math.min(i, sequence.length - 1)] ?? '';
      i += 1;
      return {
        text,
        tokenUsage: { input: 200, output: 80, model: 'claude-sonnet-4-6' },
      };
    }),
  };
  return {
    client,
    get calls() {
      return meta.calls;
    },
  };
}

describe('generateRetrospective', () => {
  it('returns generated status on compliant first attempt', async () => {
    const { client, inserted } = buildSupabaseStub([buildTrade()]);
    const llm = makeLlmStub([
      '이번 손실은 직전 2연속 손실 후 평소 보유시간의 3배를 가진 패턴과 유사합니다. 다음 회차에서는 진입 직전 흐름을 확인하십시오.',
    ]);

    const result = await generateRetrospective({
      supabase: client,
      ownerId: OWNER_ID,
      tradeId: TRADE_ID,
      llmClient: llm.client,
    });

    expect('error' in result).toBe(false);
    if ('error' in result) return;
    expect(result.status).toBe('generated');
    expect(result.filterPassed).toBe(true);
    expect(result.retrospectiveText).toContain('패턴');
    expect(result.tokenUsage.model).toBe('claude-sonnet-4-6');
    expect(inserted).toHaveLength(1);
    expect(inserted[0].retrospective_status).toBe('generated');
    expect(inserted[0].llm_token_usage).toEqual({
      input: 200,
      output: 80,
      model: 'claude-sonnet-4-6',
    });
    expect(llm.calls).toBe(1);
  });

  it('retries on warmth and succeeds on the second attempt', async () => {
    const { client, inserted } = buildSupabaseStub([buildTrade()]);
    const llm = makeLlmStub([
      '괜찮아요, 다음에 잘하면 됩니다.',
      '이번 손실은 직전 손실 1건 후 평소 보유시간의 2배를 가진 패턴과 유사합니다. 다음 회차에서는 진입 가격대를 점검하십시오.',
    ]);

    const result = await generateRetrospective({
      supabase: client,
      ownerId: OWNER_ID,
      tradeId: TRADE_ID,
      llmClient: llm.client,
    });

    expect('error' in result).toBe(false);
    if ('error' in result) return;
    expect(result.status).toBe('generated');
    expect(result.filterPassed).toBe(true);
    expect(llm.calls).toBe(2);
    expect(inserted).toHaveLength(1);
    expect(inserted[0].retrospective_status).toBe('generated');
    // The persisted snapshot records which attempt finally passed.
    const snapshot = inserted[0].llm_input_snapshot as { attempt: number; anonymized: boolean };
    expect(snapshot.attempt).toBe(2);
    expect(snapshot.anonymized).toBe(true);
  });

  it('persists filtered_out and returns failure after 3 warmth-tainted attempts', async () => {
    const { client, inserted } = buildSupabaseStub([buildTrade()]);
    const llm = makeLlmStub([
      '괜찮아요, 다음에 잘하면 됩니다.',
      '잘했어요, 수고했어요.',
      '걱정 마세요, 힘내세요. 좋은 경험입니다.',
    ]);

    const result = await generateRetrospective({
      supabase: client,
      ownerId: OWNER_ID,
      tradeId: TRADE_ID,
      llmClient: llm.client,
    });

    expect('error' in result).toBe(true);
    if (!('error' in result)) return;
    expect(result.error).toBe('tone_filter_failed');
    expect(result.attemptsUsed).toBe(3);
    expect(result.lastOutputBlocked).toContain('걱정');
    expect(llm.calls).toBe(3);
    expect(inserted).toHaveLength(1);
    expect(inserted[0].retrospective_status).toBe('filtered_out');
    expect(inserted[0].retrospective_text).toBeNull();
    expect(inserted[0].llm_input_snapshot).toMatchObject({
      filterFailed: true,
      attempt: 3,
      anonymized: true,
    });
  });
});

describe('generateRetrospective — period mode error envelopes', () => {
  it('throws ApiError 422 no_trades_in_period when window is empty', async () => {
    // Owner has one trade in May, but user asks for a March window.
    const { client } = buildSupabaseStub([buildTrade()]);
    const llm = makeLlmStub(['— unused —']);

    await expect(
      generateRetrospective({
        supabase: client,
        ownerId: OWNER_ID,
        period: { from: '2026-03-01', to: '2026-03-31' },
        llmClient: llm.client,
      }),
    ).rejects.toMatchObject({
      status: 422,
      body: expect.objectContaining({ error: 'no_trades_in_period' }),
    });
    expect(llm.calls).toBe(0); // never reaches LLM
  });

  it('throws ApiError 400 invalid_period_range when from > to', async () => {
    const { client } = buildSupabaseStub([buildTrade()]);
    const llm = makeLlmStub(['— unused —']);

    await expect(
      generateRetrospective({
        supabase: client,
        ownerId: OWNER_ID,
        period: { from: '2026-05-31', to: '2026-05-01' },
        llmClient: llm.client,
      }),
    ).rejects.toMatchObject({
      status: 400,
      body: expect.objectContaining({ error: 'invalid_period_range' }),
    });
  });

  it('accepts date-only YYYY-MM-DD boundaries and includes the full end day', async () => {
    // Trade entry at 23:30Z on the requested `to` date — must be IN window
    // (end-of-day inclusive normalization).
    const trade = buildTrade({ entry_at: '2026-05-23T23:30:00Z' });
    const { client } = buildSupabaseStub([trade]);
    const llm = makeLlmStub(['패턴 분석 결과 ...']);

    const result = await generateRetrospective({
      supabase: client,
      ownerId: OWNER_ID,
      period: { from: '2026-05-23', to: '2026-05-23' },
      llmClient: llm.client,
    });

    expect('error' in result).toBe(false);
    if ('error' in result) return;
    expect(result.filterPassed).toBe(true);
    expect(llm.calls).toBe(1);
  });
});
