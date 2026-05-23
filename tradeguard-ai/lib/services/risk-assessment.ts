// Real-time entry-risk pipeline (US4 / FR-014, FR-015, FR-025, SC-004).
//
// One end-to-end orchestrator: history load → 5 signals → weighted score
// (with Tilt-Red floor) → warning message → optional LLM explanation →
// persist `risk_assessments`. Every call writes a row (FR-018) even when
// the LLM step fails.
//
// p95 budget for the whole pipeline is 5 seconds (SC-004). The scoring is
// pure synchronous math; the only meaningful latency comes from (1) Supabase
// reads (parallelized), (2) the optional Yahoo current-snapshot fetch, and
// (3) the LLM call (3 s timeout via `lib/services/risk-explanation.ts`).

import type { SupabaseClient } from '@supabase/supabase-js';
import type {
  RiskAssessmentSignals,
  RiskAssessmentWeights,
  Trade,
  TradeSide,
  UUID,
} from '@/types/db';
import type { PropFirmRoomSummary, RiskAssessResponse, SimilarPastTrade } from '@/types/api';
import { createLlmClient } from '@/lib/llm/client';
import type { LlmClient } from '@/lib/llm/client';
import { logger } from '@/lib/utils/logger';
import { fetchSnapshot } from '@/lib/market/yahoo';
import {
  DEFAULT_WEIGHTS,
  TILT_GREEN,
  TILT_RED,
  TILT_YELLOW,
  computeRiskScore,
  effectiveWeights,
} from '@/lib/scoring/risk';
import { computeRecentPnlStreakSignal } from '@/lib/scoring/risk-signals/recent-pnl';
import { computeMarketContextSignal } from '@/lib/scoring/risk-signals/market-ctx';
import { findSimilarTrades, similarLossRate } from '@/lib/scoring/similar';
import { getAllTradesForOwner } from '@/lib/repositories/trades';
import { findActiveSession } from '@/lib/repositories/sessions';
import { findTiltCheckBySession } from '@/lib/repositories/tilt-checks';
import { insertAssessment } from '@/lib/repositories/risk-assessments';
import { getRoomsForUser } from '@/lib/services/prop-firm-room';
import { generateRiskExplanation } from '@/lib/services/risk-explanation';

const HISTORY_WINDOW_DAYS = 90;
const RECENT_PNL_WINDOW_HOURS = 2;
const SIMILAR_TOP_K = 5;
const MS_PER_DAY = 86_400_000;

export interface AssessRiskCandidate {
  symbol: string;
  side: TradeSide;
  contracts: number | null;
}

export interface AssessRiskParams {
  supabase: SupabaseClient;
  ownerId: UUID;
  candidate: AssessRiskCandidate;
  includeLLMExplanation: boolean;
  /** Inject mocks in tests; defaults are constructed inside. */
  llmClient?: Pick<LlmClient, 'messages'>;
  /** Override `now()` for deterministic tests. */
  now?: Date;
  /** Optional override for fetching the current market snapshot. */
  fetchCurrentSnapshot?: typeof fetchSnapshot;
}

// -- internal types ----------------------------------------------------

interface MarketContextLive {
  vix: number | null;
  dxy: number | null;
  volume: number | null;
  atr14: number | null;
  eventType: string | null;
  eventOffsetMinutes: number | null;
}

const EMPTY_MARKET_CONTEXT: MarketContextLive = {
  vix: null,
  dxy: null,
  volume: null,
  atr14: null,
  eventType: null,
  eventOffsetMinutes: null,
};

function tiltColorToSignal(color: 'green' | 'yellow' | 'red' | null): number | null {
  if (color === null) return null;
  if (color === 'green') return TILT_GREEN;
  if (color === 'yellow') return TILT_YELLOW;
  return TILT_RED;
}

function dominantSignal(
  signals: RiskAssessmentSignals,
  weights: RiskAssessmentWeights,
): keyof RiskAssessmentSignals | null {
  const entries: [keyof RiskAssessmentSignals, number][] = [
    ['recentPnlStreak', signals.recentPnlStreak * weights.recentPnlStreak],
    ['marketContext', signals.marketContext * weights.marketContext],
    ['similarHistoryLossRate', signals.similarHistoryLossRate * weights.similarHistoryLossRate],
    ['tilt', (signals.tilt ?? 0) * weights.tilt],
    ['propFirmRoom', (signals.propFirmRoom ?? 0) * weights.propFirmRoom],
  ];
  entries.sort((a, b) => b[1] - a[1]);
  return entries[0][1] > 0 ? entries[0][0] : null;
}

function buildWarningMessage(args: {
  score: number;
  signals: RiskAssessmentSignals;
  weights: RiskAssessmentWeights;
  propFirmHasWarning: boolean;
  floorApplied: boolean;
}): string | null {
  const { score, signals, weights, propFirmHasWarning, floorApplied } = args;

  // Prop-firm warning takes priority — SC-009 requires the word "한도" in
  // these messages so retrospective + dashboards can grep it.
  if (propFirmHasWarning || (signals.propFirmRoom !== null && signals.propFirmRoom >= 80)) {
    return '경고: Prop Firm 일일 손실 한도 사용률이 위험 수준입니다. 진입 보류 권고.';
  }

  if (floorApplied) {
    return '경고: Tilt Red 상태에서 진입 시도. 위험도 점수 하한 70 적용. 거래 중단 권고.';
  }

  if (score < 40) return null;

  const dom = dominantSignal(signals, weights);
  switch (dom) {
    case 'recentPnlStreak':
      return '주의: 직전 2시간 연속 손실 패턴이 감지되었습니다.';
    case 'marketContext':
      return '주의: 변동성/이벤트로 인한 시장 리스크가 평소보다 높습니다.';
    case 'similarHistoryLossRate':
      return '주의: 현재 행동은 과거 대손실 패턴과 유사합니다.';
    case 'tilt':
      return '주의: 멘탈 상태(Tilt) 신호가 진입 위험을 키우고 있습니다.';
    case 'propFirmRoom':
      return '경고: Prop Firm 룰 한도 여유가 줄어들고 있습니다.';
    default:
      return score >= 60 ? '주의: 진입 위험도가 높습니다.' : null;
  }
}

function filterRecentHistory(history: Trade[], now: Date): Trade[] {
  const cutoff = now.getTime() - HISTORY_WINDOW_DAYS * MS_PER_DAY;
  return history.filter((t) => {
    const ms = new Date(t.entry_at).getTime();
    return Number.isFinite(ms) && ms >= cutoff;
  });
}

async function loadSnapshotMap(
  supabase: SupabaseClient,
  ownerId: UUID,
  tradeIds: UUID[],
): Promise<Map<UUID, { vix: number | null; event_type: string | null }>> {
  const out = new Map<UUID, { vix: number | null; event_type: string | null }>();
  if (tradeIds.length === 0) return out;
  const { data, error } = await supabase
    .from('market_snapshots')
    .select('trade_id, vix, event_type')
    .eq('owner_id', ownerId)
    .in('trade_id', tradeIds);
  if (error) {
    logger.warn('risk_snapshot_map_load_failed', { message: error.message });
    return out;
  }
  for (const row of (data ?? []) as {
    trade_id: UUID;
    vix: string | null;
    event_type: string | null;
  }[]) {
    out.set(row.trade_id, {
      vix: row.vix === null ? null : Number(row.vix),
      event_type: row.event_type,
    });
  }
  return out;
}

async function loadLiveMarketContext(
  symbol: string,
  now: Date,
  fetcher: typeof fetchSnapshot,
): Promise<MarketContextLive> {
  try {
    const snap = await fetcher(symbol, now);
    if (!snap) return EMPTY_MARKET_CONTEXT;
    return {
      vix: snap.vix,
      dxy: snap.dxy,
      volume: snap.volume,
      atr14: snap.atr14,
      eventType: null,
      eventOffsetMinutes: null,
    };
  } catch (err) {
    logger.warn('risk_live_market_fetch_failed', {
      symbol,
      message: err instanceof Error ? err.message : String(err),
    });
    return EMPTY_MARKET_CONTEXT;
  }
}

function propFirmRoomSignal(rooms: PropFirmRoomSummary[], dailyUsedPctMax: number | null): number {
  if (rooms.length === 0 || dailyUsedPctMax === null) return 0;
  // dailyLossUsedPct is 0..1 (fraction). Multiply by 100 to align with
  // the 0..100 signal scale used by the weighted formula.
  const signal = Math.round(dailyUsedPctMax * 100);
  return Math.max(0, Math.min(100, signal));
}

function similarHistoryLossRateSignal(rate: number | null): number {
  // (rate - 0.5) * 200, clamped to [0, 100]. 50% loss rate → 0; 100% → 100.
  if (rate === null) return 0;
  const v = (rate - 0.5) * 200;
  return Math.max(0, Math.min(100, Math.round(v)));
}

// -- main entry point --------------------------------------------------

export async function assessRisk(params: AssessRiskParams): Promise<RiskAssessResponse> {
  const { supabase, ownerId, candidate, includeLLMExplanation } = params;
  const now = params.now ?? new Date();
  const fetcher = params.fetchCurrentSnapshot ?? fetchSnapshot;

  // 1. Trade history (last 90d).
  const allHistory = await getAllTradesForOwner(supabase, ownerId);
  const history = filterRecentHistory(allHistory, now);

  // 2. Active session + tilt check.
  const session = await findActiveSession(supabase, ownerId);
  const tiltCheck = session ? await findTiltCheckBySession(supabase, session.id) : null;
  const tiltSignal = tiltCheck ? tiltColorToSignal(tiltCheck.tilt_color) : null;

  // 3. Prop-firm rooms.
  const rooms = await getRoomsForUser(supabase, ownerId);
  const roomSummaries: PropFirmRoomSummary[] = rooms.map((r) => ({
    profileId: r.id,
    label: r.firmLabel ?? r.firmName,
    dailyLossRoom: r.currentRoom?.dailyLossRoom ?? null,
    drawdownRoom: r.currentRoom?.drawdownRoom ?? 0,
  }));
  const dailyUsedPctMax: number | null = rooms.reduce<number | null>((acc, r) => {
    const p = r.currentRoom?.dailyLossUsedPct ?? null;
    if (p === null) return acc;
    return acc === null ? p : Math.max(acc, p);
  }, null);
  const propFirmAnyWarning = rooms.some((r) => r.currentRoom?.warningActive ?? false);
  const propFirmSignal: number | null =
    rooms.length === 0 ? null : propFirmRoomSignal(roomSummaries, dailyUsedPctMax);

  // 4. Recent PnL streak (last 2h).
  const recentPnlStreak = computeRecentPnlStreakSignal({
    recentTrades: history.map((t) => ({
      pnl: t.pnl === null ? null : Number(t.pnl),
      exit_at: t.exit_at,
    })),
    nowUtcIso: now.toISOString(),
    windowHours: RECENT_PNL_WINDOW_HOURS,
  });

  // 5. Live market snapshot.
  const market = await loadLiveMarketContext(candidate.symbol, now, fetcher);
  const marketContext = computeMarketContextSignal({
    vix: market.vix,
    eventType: market.eventType,
    eventOffsetMinutes: market.eventOffsetMinutes,
  });

  // 7. Similar past trades + loss rate.
  const snapshotMap = await loadSnapshotMap(
    supabase,
    ownerId,
    history.map((t) => t.id),
  );
  const similar = findSimilarTrades({
    history,
    candidate: {
      symbol: candidate.symbol,
      side: candidate.side,
      currentVix: market.vix,
      currentEvent: market.eventType,
    },
    topK: SIMILAR_TOP_K,
    snapshotsByTradeId: snapshotMap,
  });
  const similarLossSignal = similarHistoryLossRateSignal(similarLossRate(similar));

  // 8-9. Build signals + score.
  const signals: RiskAssessmentSignals = {
    recentPnlStreak,
    marketContext,
    similarHistoryLossRate: similarLossSignal,
    tilt: tiltSignal,
    propFirmRoom: propFirmSignal,
  };
  const effective = effectiveWeights(DEFAULT_WEIGHTS, signals);
  const { score, floorApplied } = computeRiskScore(signals, DEFAULT_WEIGHTS);

  // 10. Warning message.
  const warningMessage = buildWarningMessage({
    score,
    signals,
    weights: effective,
    propFirmHasWarning: propFirmAnyWarning,
    floorApplied,
  });

  // 11. Optional LLM explanation (3s timeout, deterministic fallback).
  let llmExplanation: string | null = null;
  if (includeLLMExplanation) {
    const llm = params.llmClient ?? safeLlmClient();
    if (llm) {
      // Only pass telemetry when the LlmClient is real (it carries the
      // provider tag). Mock clients used by tests usually omit `provider`
      // — falling back to undefined disables telemetry recording in that case.
      const llmProvider = 'provider' in llm ? (llm as LlmClient).provider : undefined;
      const telemetry = llmProvider
        ? { supabase, ownerId, provider: llmProvider }
        : undefined;
      llmExplanation = await generateRiskExplanation(
        llm,
        {
          riskScore: score,
          signals,
          effectiveWeights: effective,
          warningMessage,
          floorApplied,
          candidate: {
            symbol: candidate.symbol,
            side: candidate.side,
            contracts: candidate.contracts,
          },
        },
        telemetry,
      );
    }
  }

  // Compose similar-past-trades response payload.
  const similarResponse: SimilarPastTrade[] = similar.map((m) => {
    const trade = history.find((t) => t.id === m.tradeId);
    return {
      tradeId: m.tradeId,
      entryAt: trade?.entry_at ?? now.toISOString(),
      pnl: m.pnl,
      similarity: Number(m.similarity.toFixed(4)),
    };
  });

  // 12. Persist (FR-018).
  const marketSnapshotJson: Record<string, unknown> = {
    vix: market.vix,
    dxy: market.dxy,
    volume: market.volume,
    atr14: market.atr14,
    eventType: market.eventType,
    eventOffsetMinutes: market.eventOffsetMinutes,
  };
  const propFirmSnapshotJson: Record<string, unknown> = {
    rooms: roomSummaries,
    dailyUsedPctMax,
    anyWarningActive: propFirmAnyWarning,
  };
  const llmInputSnapshot: Record<string, unknown> = {
    signals,
    weights: effective,
    floorApplied,
    candidate,
    requestedAt: now.toISOString(),
    similarCount: similar.length,
  };

  const persisted = await insertAssessment(supabase, ownerId, {
    session_id: session?.id ?? null,
    candidate_symbol: candidate.symbol,
    candidate_side: candidate.side,
    candidate_contracts: candidate.contracts,
    risk_score: score,
    signals_breakdown: signals,
    warning_message: warningMessage,
    tilt_check_id: tiltCheck?.id ?? null,
    market_snapshot: marketSnapshotJson,
    prop_firm_room_snapshot: propFirmSnapshotJson,
    llm_explanation: llmExplanation,
    llm_input_snapshot: llmInputSnapshot,
  });

  // 13. Shape response.
  return {
    assessmentId: persisted.id,
    riskScore: score,
    signalsBreakdown: signals,
    weights: effective,
    warningMessage,
    tiltColor: tiltCheck ? tiltCheck.tilt_color : 'absent',
    propFirmRoom: roomSummaries,
    similarPastTrades: similarResponse,
    llmExplanation,
    warningRaisedAt: persisted.requested_at,
  };
}

function safeLlmClient(): LlmClient | null {
  try {
    return createLlmClient();
  } catch (err) {
    logger.warn('risk_llm_client_unavailable', {
      message: err instanceof Error ? err.message : String(err),
    });
    return null;
  }
}
