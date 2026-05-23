// Shared helpers + DTO types for the trades repository.
// Split out so `trades.ts` stays under the 250-line per-file budget.

import type { Analysis, MarketSnapshot, Trade, UUID } from '@/types/db';
import type { TradeSummary } from '@/types/api';

export interface AnalysisDetail {
  id: UUID;
  stopDelayScore: number | null;
  revengeScore: number | null;
  overconfidenceScore: number | null;
  riskScore: number | null;
  retrospectiveStatus: Analysis['retrospective_status'];
  retrospectiveText: string | null;
  createdAt: string;
}

export interface MarketSnapshotDetail {
  vix: number | null;
  dxy: number | null;
  atr14: number | null;
  volume: number | null;
  eventType: MarketSnapshot['event_type'];
  eventOffsetMinutes: number | null;
  dataSource: MarketSnapshot['data_source'];
}

export interface TradeDetail {
  trade: TradeSummary;
  analyses: AnalysisDetail[];
  marketSnapshot: MarketSnapshotDetail | null;
}

export function toNumOrNull(v: string | null): number | null {
  return v === null ? null : Number(v);
}

export function toNum(v: string): number {
  return Number(v);
}

export function toTradeSummary(
  t: Trade,
  hasMarketContext: boolean,
  latestAnalysis: { id: UUID; risk_score: number | null } | null,
): TradeSummary {
  return {
    id: t.id,
    symbol: t.symbol,
    side: t.side,
    entryAt: t.entry_at,
    exitAt: t.exit_at,
    entryPrice: toNum(t.entry_price),
    exitPrice: toNumOrNull(t.exit_price),
    contracts: toNum(t.contracts),
    pnl: toNumOrNull(t.pnl),
    hasMarketContext,
    latestAnalysis: latestAnalysis
      ? { id: latestAnalysis.id, riskScore: latestAnalysis.risk_score }
      : null,
  };
}

export function toAnalysisDetail(a: Analysis): AnalysisDetail {
  return {
    id: a.id,
    stopDelayScore: a.stop_delay_score,
    revengeScore: a.revenge_score,
    overconfidenceScore: a.overconfidence_score,
    riskScore: a.risk_score,
    retrospectiveStatus: a.retrospective_status,
    retrospectiveText: a.retrospective_text,
    createdAt: a.created_at,
  };
}

export function toMarketSnapshotDetail(s: MarketSnapshot): MarketSnapshotDetail {
  return {
    vix: toNumOrNull(s.vix),
    dxy: toNumOrNull(s.dxy),
    atr14: toNumOrNull(s.atr_14),
    volume: s.volume === null ? null : Number(s.volume),
    eventType: s.event_type,
    eventOffsetMinutes: s.event_offset_minutes,
    dataSource: s.data_source,
  };
}
