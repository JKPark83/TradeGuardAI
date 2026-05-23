/**
 * MarketSnapshotCard — displays the per-trade market snapshot (US3).
 *
 * Accepts either the canonical DB shape (`MarketSnapshot`) or the trimmed
 * API shape (`vix`, `atr14`, `eventType`) returned by `GET /api/trades/[id]`.
 * Numeric values may arrive as strings (NUMERIC columns) or numbers
 * (JSON responses), so we normalize at the boundary.
 *
 * Empty snapshot → muted placeholder with a retry hint pointing at the
 * batch backfill flow (`<MarketBackfillButton />`).
 */

import type { ReactNode } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import type { EventType } from '@/types/db';

interface SnapshotInput {
  vix?: number | string | null;
  dxy?: number | string | null;
  volume?: number | string | null;
  atr_14?: number | string | null;
  atr14?: number | string | null;
  event_type?: EventType | string | null;
  eventType?: EventType | string | null;
  event_offset_minutes?: number | null;
  eventOffsetMinutes?: number | null;
}

interface MarketSnapshotCardProps {
  snapshot: SnapshotInput | null;
}

const EVENT_LABEL: Record<EventType, string> = {
  cpi: 'CPI 발표',
  fomc: 'FOMC',
  nfp: 'NFP',
  cbproductivity: '생산성지표',
  normal: '일반',
};

function toNumber(value: number | string | null | undefined): number | null {
  if (value === null || value === undefined || value === '') return null;
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) ? n : null;
}

function formatNumber(value: number | null, digits = 2): string {
  if (value === null) return '—';
  return value.toLocaleString('en-US', {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
}

function formatVolume(value: number | null): string {
  if (value === null) return '—';
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(2)}M`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(1)}K`;
  return value.toLocaleString('en-US');
}

function eventLabel(type: string | null | undefined): string {
  if (!type) return '—';
  if (type in EVENT_LABEL) return EVENT_LABEL[type as EventType];
  return type;
}

function formatOffset(minutes: number | null | undefined, type: string | null | undefined): string {
  if (minutes === null || minutes === undefined) return '';
  if (!type || type === 'normal') return '';
  const abs = Math.abs(minutes);
  if (abs === 0) return ' (당시 발표)';
  return minutes > 0 ? ` (${abs}분 후)` : ` (${abs}분 전)`;
}

export function MarketSnapshotCard({ snapshot }: MarketSnapshotCardProps): ReactNode {
  if (!snapshot) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>시장 컨텍스트</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-2">
          <p className="text-sm text-muted-foreground">시장 컨텍스트 없음</p>
          <p className="text-xs text-muted-foreground">
            거래 목록 상단의 &quot;시장 컨텍스트 채우기&quot;를 실행하면 이 거래의 진입 시각 기준
            시장 데이터가 채워집니다.
          </p>
        </CardContent>
      </Card>
    );
  }

  const vix = toNumber(snapshot.vix);
  const dxy = toNumber(snapshot.dxy);
  const atr = toNumber(snapshot.atr_14 ?? snapshot.atr14);
  const volume = toNumber(snapshot.volume);
  const eventType = snapshot.event_type ?? snapshot.eventType ?? null;
  const offset = snapshot.event_offset_minutes ?? snapshot.eventOffsetMinutes ?? null;

  return (
    <Card>
      <CardHeader>
        <CardTitle>시장 컨텍스트</CardTitle>
      </CardHeader>
      <CardContent className="grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-5">
        <Stat label="VIX" value={formatNumber(vix)} />
        <Stat label="DXY" value={formatNumber(dxy)} />
        <Stat label="ATR-14" value={formatNumber(atr, 3)} />
        <Stat label="거래량" value={formatVolume(volume)} />
        <Stat label="이벤트" value={`${eventLabel(eventType)}${formatOffset(offset, eventType)}`} />
      </CardContent>
    </Card>
  );
}

interface StatProps {
  label: string;
  value: string;
}

function Stat({ label, value }: StatProps): ReactNode {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-xs uppercase tracking-wider text-muted-foreground">{label}</span>
      <span className="text-sm tabular-nums text-foreground">{value}</span>
    </div>
  );
}
