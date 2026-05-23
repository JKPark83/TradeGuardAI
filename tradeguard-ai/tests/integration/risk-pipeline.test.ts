/**
 * Risk-assessment pipeline integration tests.
 *
 * Validates the end-to-end behavior of `lib/services/risk-assessment.ts`:
 *   - SC-008: Tilt=Red active → riskScore >= 70
 *   - SC-009 spirit: Prop Firm 80%+ used → warningMessage contains "한도"
 *   - 5신호 모두 정상 → riskScore < 70
 *   - Weight redistribution when tilt/propFirm absent
 *   - Persistence (FR-018) — every call writes a `risk_assessments` row
 *   - Warning linker: high-score assessment + later trade → linker returns true
 *
 * Supabase is mocked end-to-end via a hand-rolled in-memory store keyed by
 * table. The Yahoo fetcher and LlmClient are dependency-injected.
 */

import { describe, expect, it, beforeEach, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';

import { assessRisk } from '@/lib/services/risk-assessment';
import { linkPriorWarningToTrade } from '@/lib/services/warning-linker';
import { TILT_RED_FLOOR } from '@/lib/scoring/risk';
import type { LlmClient, LlmMessageResult } from '@/lib/llm/client';
import type {
  MarketSnapshot,
  PropFirmProfile,
  RiskAssessment,
  TiltCheck,
  Trade,
  TradingSession,
} from '@/types/db';

// ---- In-memory store ---------------------------------------------------

interface Stores {
  trades: Trade[];
  trading_sessions: TradingSession[];
  tilt_checks: TiltCheck[];
  prop_firm_profiles: PropFirmProfile[];
  market_snapshots: MarketSnapshot[];
  risk_assessments: RiskAssessment[];
  prop_firm_eod_balances: Array<{ profile_id: string; eod_date: string; eod_balance: string }>;
}

function emptyStores(): Stores {
  return {
    trades: [],
    trading_sessions: [],
    tilt_checks: [],
    prop_firm_profiles: [],
    market_snapshots: [],
    risk_assessments: [],
    prop_firm_eod_balances: [],
  };
}

type Row = Record<string, unknown>;
interface Filter {
  col: string;
  op: 'eq' | 'is_null' | 'is_not_null' | 'gte' | 'lte' | 'in';
  val: unknown;
}

function buildMockSupabase(stores: Stores): SupabaseClient {
  let riskSeq = 0;

  const tableRowsOf = (t: keyof Stores): Row[] => stores[t] as unknown as Row[];

  const matches =
    (filters: Filter[]) =>
    (row: Row): boolean =>
      filters.every((f) => {
        const v = row[f.col];
        switch (f.op) {
          case 'eq':
            return v === f.val;
          case 'is_null':
            return v === null;
          case 'is_not_null':
            return v !== null;
          case 'gte':
            return v !== null && String(v) >= String(f.val);
          case 'lte':
            return v !== null && String(v) <= String(f.val);
          case 'in':
            return Array.isArray(f.val) && (f.val as unknown[]).includes(v);
        }
      });

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const from = vi.fn((table: string): any => {
    const filters: Filter[] = [];
    let pendingInsert: Row | Row[] | null = null;
    let orderCol: string | null = null;
    let orderAsc = true;
    let limitN: number | null = null;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const builder: any = {};

    const applyInsert = () => {
      if (table === 'risk_assessments') {
        const inserts = Array.isArray(pendingInsert) ? pendingInsert : [pendingInsert as Row];
        const result = inserts.map((p) => {
          riskSeq += 1;
          const row: RiskAssessment = {
            id: `assess-${riskSeq}`,
            owner_id: p.owner_id as string,
            session_id: (p.session_id as string | null) ?? null,
            requested_at: new Date().toISOString(),
            candidate_symbol: p.candidate_symbol as string,
            candidate_side: p.candidate_side as 'long' | 'short',
            candidate_contracts: (p.candidate_contracts as string | null) ?? null,
            risk_score: p.risk_score as number,
            signals_breakdown: p.signals_breakdown as RiskAssessment['signals_breakdown'],
            warning_message: (p.warning_message as string | null) ?? null,
            tilt_check_id: (p.tilt_check_id as string | null) ?? null,
            market_snapshot: (p.market_snapshot as Record<string, unknown> | null) ?? null,
            prop_firm_room_snapshot:
              (p.prop_firm_room_snapshot as Record<string, unknown> | null) ?? null,
            llm_explanation: (p.llm_explanation as string | null) ?? null,
            llm_input_snapshot: (p.llm_input_snapshot as Record<string, unknown> | null) ?? null,
          };
          stores.risk_assessments.push(row);
          return row as unknown as Row;
        });
        return Array.isArray(pendingInsert) ? result : result[0];
      }
      return null;
    };

    const applyFilter = () => {
      const rows = tableRowsOf(table as keyof Stores).filter(matches(filters));
      if (orderCol) {
        rows.sort((a, b) => {
          const av = String(a[orderCol as string] ?? '');
          const bv = String(b[orderCol as string] ?? '');
          if (av < bv) return orderAsc ? -1 : 1;
          if (av > bv) return orderAsc ? 1 : -1;
          return 0;
        });
      }
      if (limitN !== null) return rows.slice(0, limitN);
      return rows;
    };

    builder.select = vi.fn(() => builder);
    builder.insert = vi.fn((p: Row | Row[]) => {
      pendingInsert = p;
      return builder;
    });
    builder.eq = vi.fn((c: string, v: unknown) => {
      filters.push({ col: c, op: 'eq', val: v });
      return builder;
    });
    builder.is = vi.fn((c: string, v: unknown) => {
      if (v === null) filters.push({ col: c, op: 'is_null', val: null });
      return builder;
    });
    builder.not = vi.fn((c: string, _op: string, v: unknown) => {
      if (v === null) filters.push({ col: c, op: 'is_not_null', val: null });
      return builder;
    });
    builder.gte = vi.fn((c: string, v: unknown) => {
      filters.push({ col: c, op: 'gte', val: v });
      return builder;
    });
    builder.lte = vi.fn((c: string, v: unknown) => {
      filters.push({ col: c, op: 'lte', val: v });
      return builder;
    });
    builder.in = vi.fn((c: string, v: unknown[]) => {
      filters.push({ col: c, op: 'in', val: v });
      return builder;
    });
    builder.order = vi.fn((c: string, opts?: { ascending?: boolean }) => {
      orderCol = c;
      orderAsc = opts?.ascending !== false;
      return builder;
    });
    builder.limit = vi.fn((n: number) => {
      limitN = n;
      return builder;
    });
    builder.maybeSingle = vi.fn(async () => {
      const rows = applyFilter();
      return { data: rows[0] ?? null, error: null };
    });
    builder.single = vi.fn(async () => {
      if (pendingInsert) {
        const r = applyInsert();
        return { data: r, error: null };
      }
      const rows = applyFilter();
      return { data: rows[0] ?? null, error: null };
    });
    builder.then = (resolve: (r: { data: Row[] | null; error: null }) => void) => {
      if (pendingInsert) {
        const r = applyInsert();
        resolve({ data: Array.isArray(r) ? r : r ? [r] : null, error: null });
        return;
      }
      resolve({ data: applyFilter(), error: null });
    };
    return builder;
  });

  return { from } as unknown as SupabaseClient;
}

// ---- Fixtures ---------------------------------------------------------

const OWNER = 'owner-1';

function pushTrade(stores: Stores, t: Partial<Trade>): Trade {
  const row: Trade = {
    id: t.id ?? `trade-${stores.trades.length + 1}`,
    owner_id: OWNER,
    session_id: null,
    symbol: 'NQ',
    side: 'long',
    entry_price: '20000',
    exit_price: '19950',
    entry_at: '2026-05-22T13:00:00Z',
    exit_at: '2026-05-22T14:00:00Z',
    pnl: '-100',
    contracts: '2',
    source_csv_id: null,
    source_row: null,
    created_at: '2026-05-22T14:00:00Z',
    ...t,
  };
  stores.trades.push(row);
  return row;
}

function pushSession(stores: Stores): TradingSession {
  const sess: TradingSession = {
    id: 'sess-1',
    owner_id: OWNER,
    started_at: '2026-05-23T12:00:00Z',
    ended_at: null,
    created_at: '2026-05-23T12:00:00Z',
  };
  stores.trading_sessions.push(sess);
  return sess;
}

function pushTiltRed(stores: Stores, sessionId: string): TiltCheck {
  const tilt: TiltCheck = {
    id: 'tilt-1',
    session_id: sessionId,
    owner_id: OWNER,
    sleep_score: 2,
    stress_score: 9,
    external_event: null,
    external_event_serious: true,
    tilt_color: 'red',
    raw_score: '30.00',
    submitted_at: '2026-05-23T12:05:00Z',
  };
  stores.tilt_checks.push(tilt);
  return tilt;
}

function pushPropFirm(stores: Stores, overrides: Partial<PropFirmProfile> = {}): PropFirmProfile {
  const row: PropFirmProfile = {
    id: 'prof-1',
    owner_id: OWNER,
    firm_name: 'topstep',
    firm_label: 'Topstep 50K',
    account_size: '50000',
    daily_loss_limit: '1000',
    drawdown_type: 'static',
    drawdown_limit: '2000',
    warn_threshold_pct: '0.80',
    is_active: true,
    created_at: '2026-05-23T12:00:00Z',
    ...overrides,
  };
  stores.prop_firm_profiles.push(row);
  return row;
}

function makeLlmStub(text = '직전 손실 streak 비중이 가장 큼 — 진입 전 패턴 재확인 필요.'): {
  client: Pick<LlmClient, 'messages'>;
  calls: number;
} {
  const meta = { calls: 0 };
  const client: Pick<LlmClient, 'messages'> = {
    messages: vi.fn(async (): Promise<LlmMessageResult> => {
      meta.calls += 1;
      return { text, tokenUsage: { input: 100, output: 30, model: 'claude-sonnet-4-6' } };
    }),
  };
  return {
    client,
    get calls() {
      return meta.calls;
    },
  };
}

function makeYahooStub(
  snap: {
    vix: number | null;
    dxy: number | null;
    volume: number | null;
    atr14: number | null;
  } | null,
) {
  return vi.fn(async () => snap);
}

// ---- Tests ------------------------------------------------------------

describe('assessRisk — Tilt=Red floor (SC-008)', () => {
  let stores: Stores;
  let supabase: SupabaseClient;

  beforeEach(() => {
    stores = emptyStores();
    supabase = buildMockSupabase(stores);
    const sess = pushSession(stores);
    pushTiltRed(stores, sess.id);
  });

  it('riskScore >= 70 when active session has Red tilt + minimal other signals', async () => {
    const llm = makeLlmStub();
    const yahoo = makeYahooStub({ vix: 15, dxy: 100, volume: 1000, atr14: 30 });
    const result = await assessRisk({
      supabase,
      ownerId: OWNER,
      candidate: { symbol: 'NQ', side: 'long', contracts: 2 },
      includeLLMExplanation: false,
      llmClient: llm.client,
      now: new Date('2026-05-23T13:00:00Z'),
      fetchCurrentSnapshot: yahoo,
    });
    expect(result.riskScore).toBeGreaterThanOrEqual(TILT_RED_FLOOR);
    expect(result.tiltColor).toBe('red');
    expect(stores.risk_assessments).toHaveLength(1);
  });
});

describe('assessRisk — Prop Firm 80%+ warning', () => {
  let stores: Stores;
  let supabase: SupabaseClient;

  beforeEach(() => {
    stores = emptyStores();
    supabase = buildMockSupabase(stores);
    pushPropFirm(stores);
    // 850 loss today → 85% of 1000 daily_loss_limit.
    pushTrade(stores, {
      id: 't-loss',
      pnl: '-850',
      exit_at: '2026-05-23T15:00:00Z',
    });
  });

  it('warningMessage contains "한도" when daily-loss usage >= 80%', async () => {
    const yahoo = makeYahooStub({ vix: 15, dxy: 100, volume: 1, atr14: 1 });
    const result = await assessRisk({
      supabase,
      ownerId: OWNER,
      candidate: { symbol: 'NQ', side: 'long', contracts: 1 },
      includeLLMExplanation: false,
      now: new Date('2026-05-23T16:00:00Z'),
      fetchCurrentSnapshot: yahoo,
    });
    expect(result.warningMessage).not.toBeNull();
    expect(result.warningMessage).toContain('한도');
    expect(result.propFirmRoom.length).toBeGreaterThan(0);
  });
});

describe('assessRisk — 5신호 정상 → score < 70', () => {
  it('low-risk scenario stays below the warning threshold', async () => {
    const stores = emptyStores();
    const supabase = buildMockSupabase(stores);
    const yahoo = makeYahooStub({ vix: 14, dxy: 100, volume: 1, atr14: 1 });
    const result = await assessRisk({
      supabase,
      ownerId: OWNER,
      candidate: { symbol: 'NQ', side: 'long', contracts: 1 },
      includeLLMExplanation: false,
      now: new Date('2026-05-23T13:00:00Z'),
      fetchCurrentSnapshot: yahoo,
    });
    expect(result.riskScore).toBeLessThan(70);
    expect(result.tiltColor).toBe('absent');
    expect(stores.risk_assessments).toHaveLength(1);
  });
});

describe('assessRisk — weight redistribution', () => {
  it('weights sum to 1.0 when tilt + propFirm absent', async () => {
    const stores = emptyStores();
    const supabase = buildMockSupabase(stores);
    const yahoo = makeYahooStub({ vix: 14, dxy: 100, volume: 1, atr14: 1 });
    const result = await assessRisk({
      supabase,
      ownerId: OWNER,
      candidate: { symbol: 'NQ', side: 'long', contracts: 1 },
      includeLLMExplanation: false,
      now: new Date('2026-05-23T13:00:00Z'),
      fetchCurrentSnapshot: yahoo,
    });
    const w = result.weights;
    const sum =
      w.recentPnlStreak + w.marketContext + w.similarHistoryLossRate + w.tilt + w.propFirmRoom;
    expect(sum).toBeCloseTo(1.0, 10);
    expect(w.tilt).toBe(0);
    expect(w.propFirmRoom).toBe(0);
  });
});

describe('assessRisk — persistence (FR-018)', () => {
  it('persists exactly one row per call, even without LLM explanation', async () => {
    const stores = emptyStores();
    const supabase = buildMockSupabase(stores);
    const yahoo = makeYahooStub({ vix: 14, dxy: 100, volume: 1, atr14: 1 });
    await assessRisk({
      supabase,
      ownerId: OWNER,
      candidate: { symbol: 'NQ', side: 'long', contracts: 1 },
      includeLLMExplanation: false,
      now: new Date('2026-05-23T13:00:00Z'),
      fetchCurrentSnapshot: yahoo,
    });
    expect(stores.risk_assessments).toHaveLength(1);
    expect(stores.risk_assessments[0].signals_breakdown).toMatchObject({
      tilt: null,
      propFirmRoom: null,
    });
  });
});

describe('linkPriorWarningToTrade — SC-005 retrospective linkage', () => {
  it('returns true when a high-score assessment is within ±5min of trade entry', async () => {
    const stores = emptyStores();
    const supabase = buildMockSupabase(stores);
    // Seed a high-risk assessment from 2 minutes before the trade.
    stores.risk_assessments.push({
      id: 'assess-pre',
      owner_id: OWNER,
      session_id: null,
      requested_at: '2026-05-23T13:28:00Z',
      candidate_symbol: 'NQ',
      candidate_side: 'long',
      candidate_contracts: null,
      risk_score: 82,
      signals_breakdown: {
        recentPnlStreak: 60,
        marketContext: 40,
        similarHistoryLossRate: 70,
        tilt: 100,
        propFirmRoom: null,
      },
      warning_message: null,
      tilt_check_id: null,
      market_snapshot: null,
      prop_firm_room_snapshot: null,
      llm_explanation: null,
      llm_input_snapshot: null,
    });
    const trade = pushTrade(stores, {
      id: 'trade-after',
      symbol: 'NQ',
      side: 'long',
      entry_at: '2026-05-23T13:30:00Z',
    });
    const result = await linkPriorWarningToTrade(supabase, OWNER, trade);
    expect(result).toBe(true);
  });

  it('returns false when no qualifying assessment exists', async () => {
    const stores = emptyStores();
    const supabase = buildMockSupabase(stores);
    const trade = pushTrade(stores, {
      id: 'trade-orphan',
      symbol: 'NQ',
      side: 'long',
      entry_at: '2026-05-23T13:30:00Z',
    });
    const result = await linkPriorWarningToTrade(supabase, OWNER, trade);
    expect(result).toBe(false);
  });

  it('returns false when nearby assessment is below the warning threshold', async () => {
    const stores = emptyStores();
    const supabase = buildMockSupabase(stores);
    stores.risk_assessments.push({
      id: 'assess-low',
      owner_id: OWNER,
      session_id: null,
      requested_at: '2026-05-23T13:29:00Z',
      candidate_symbol: 'NQ',
      candidate_side: 'long',
      candidate_contracts: null,
      risk_score: 40,
      signals_breakdown: {
        recentPnlStreak: 30,
        marketContext: 0,
        similarHistoryLossRate: 0,
        tilt: 0,
        propFirmRoom: 0,
      },
      warning_message: null,
      tilt_check_id: null,
      market_snapshot: null,
      prop_firm_room_snapshot: null,
      llm_explanation: null,
      llm_input_snapshot: null,
    });
    const trade = pushTrade(stores, {
      id: 'trade-low',
      symbol: 'NQ',
      side: 'long',
      entry_at: '2026-05-23T13:30:00Z',
    });
    const result = await linkPriorWarningToTrade(supabase, OWNER, trade);
    expect(result).toBe(false);
  });
});
