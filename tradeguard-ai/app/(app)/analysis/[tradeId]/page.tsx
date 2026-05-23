/**
 * `/analysis/[tradeId]` — single-trade detail with deterministic analysis scores.
 *
 * Server component that fetches `/api/trades/[id]` via the project's Supabase
 * server client cookies (forwarded via `next/headers`). The "회고 생성" CTA is
 * wired to `<RetrospectiveGenerator />` (US2) which calls
 * `POST /api/analysis/retrospective` and renders the result inline.
 */

import type { ReactNode } from 'react';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { cookies, headers } from 'next/headers';
import { ArrowLeft } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { RetrospectiveGenerator } from '@/components/retrospective/RetrospectiveGenerator';
import { MarketSnapshotCard } from '@/components/trades/MarketSnapshotCard';
import { cn } from '@/lib/utils/cn';
import type { TradeSide, RetrospectiveStatus } from '@/types/db';

export const dynamic = 'force-dynamic';

interface TradeDetail {
  trade: {
    id: string;
    symbol: string;
    side: TradeSide;
    entryAt: string;
    exitAt: string | null;
    entryPrice: number;
    exitPrice: number | null;
    contracts: number;
    pnl: number | null;
  };
  marketSnapshot: {
    vix: number | null;
    atr14: number | null;
    eventType: string | null;
  } | null;
  analyses: {
    id: string;
    stopDelayScore: number | null;
    revengeScore: number | null;
    overconfidenceScore: number | null;
    retrospectiveStatus: RetrospectiveStatus;
    retrospectiveText: string | null;
  }[];
}

async function fetchTrade(tradeId: string): Promise<TradeDetail | null> {
  const h = await headers();
  const c = await cookies();
  const host = h.get('host');
  const proto = h.get('x-forwarded-proto') ?? 'http';
  const base = host
    ? `${proto}://${host}`
    : (process.env.NEXT_PUBLIC_SITE_URL ?? 'http://localhost:3000');

  const cookieHeader = c
    .getAll()
    .map(({ name, value }) => `${name}=${value}`)
    .join('; ');

  const res = await fetch(`${base}/api/trades/${tradeId}`, {
    cache: 'no-store',
    headers: { cookie: cookieHeader },
  });
  if (res.status === 404) return null;
  if (!res.ok) {
    throw new Error(`Failed to fetch trade: HTTP ${res.status}`);
  }
  return (await res.json()) as TradeDetail;
}

function formatDateTime(iso: string | null): string {
  if (!iso) return '미청산';
  return iso.replace('T', ' ').slice(0, 16);
}

function formatPnl(pnl: number | null): { text: string; cls: string } {
  if (pnl === null) return { text: '—', cls: 'text-muted-foreground' };
  const sign = pnl > 0 ? '+' : '';
  const cls = pnl > 0 ? 'text-tilt-green' : pnl < 0 ? 'text-tilt-red' : 'text-muted-foreground';
  return { text: `${sign}${pnl.toFixed(2)}`, cls };
}

interface PageProps {
  params: Promise<{ tradeId: string }>;
}

export default async function AnalysisDetailPage({ params }: PageProps): Promise<ReactNode> {
  const { tradeId } = await params;
  const detail = await fetchTrade(tradeId);
  if (!detail) notFound();

  const { trade, analyses, marketSnapshot } = detail;
  const latest = analyses[0] ?? null;
  const pnl = formatPnl(trade.pnl);

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-2">
        <Link
          href="/trades"
          className="inline-flex items-center gap-1 self-start text-xs text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="h-3.5 w-3.5" /> 거래 목록으로
        </Link>
        <h1 className="text-xl font-semibold tracking-tight">
          {trade.symbol} <span className="text-muted-foreground">·</span>{' '}
          <span className={trade.side === 'long' ? 'text-tilt-green' : 'text-tilt-red'}>
            {trade.side === 'long' ? '매수' : '매도'}
          </span>
        </h1>
      </header>

      <Card>
        <CardHeader>
          <CardTitle>거래 요약</CardTitle>
        </CardHeader>
        <CardContent className="grid grid-cols-2 gap-4 md:grid-cols-4">
          <Stat label="진입 시각" value={formatDateTime(trade.entryAt)} />
          <Stat label="청산 시각" value={formatDateTime(trade.exitAt)} />
          <Stat label="진입가" value={trade.entryPrice.toFixed(2)} />
          <Stat
            label="청산가"
            value={trade.exitPrice !== null ? trade.exitPrice.toFixed(2) : '—'}
          />
          <Stat label="계약수" value={String(trade.contracts)} />
          <Stat label="손익" value={pnl.text} valueClass={pnl.cls} />
        </CardContent>
      </Card>

      <MarketSnapshotCard snapshot={marketSnapshot} />

      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle>행동 분석 점수</CardTitle>
          <RetrospectiveGenerator tradeId={trade.id} />
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          {latest ? (
            <>
              <ScoreBar label="손절 지연 점수" value={latest.stopDelayScore} />
              <ScoreBar label="복구매매 점수" value={latest.revengeScore} />
              <ScoreBar label="확신 과다 점수" value={latest.overconfidenceScore} />
              {latest.retrospectiveText ? (
                <div className="rounded-md border border-border bg-background p-3 text-sm text-foreground">
                  <p className="mb-2 text-xs uppercase tracking-wider text-muted-foreground">
                    회고 (상태: {latest.retrospectiveStatus})
                  </p>
                  <p className="whitespace-pre-wrap leading-relaxed">{latest.retrospectiveText}</p>
                </div>
              ) : (
                <p className="text-xs text-muted-foreground">아직 생성된 회고가 없습니다.</p>
              )}
            </>
          ) : (
            <p className="text-sm text-muted-foreground">
              아직 분석되지 않은 거래입니다. 분석 일괄 실행 후 다시 확인하세요.
            </p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function Stat({
  label,
  value,
  valueClass,
}: {
  label: string;
  value: string;
  valueClass?: string;
}): ReactNode {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-xs uppercase tracking-wider text-muted-foreground">{label}</span>
      <span className={cn('text-sm tabular-nums', valueClass)}>{value}</span>
    </div>
  );
}

function ScoreBar({ label, value }: { label: string; value: number | null }): ReactNode {
  const v = value ?? 0;
  const clamped = Math.max(0, Math.min(100, v));
  const tone = v >= 70 ? 'bg-tilt-red' : v >= 40 ? 'bg-tilt-yellow' : 'bg-tilt-green';
  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-baseline justify-between">
        <span className="text-xs text-muted-foreground">{label}</span>
        <span className="text-sm tabular-nums text-foreground">
          {value === null ? '—' : `${v}/100`}
        </span>
      </div>
      <div className="h-2 w-full overflow-hidden rounded-sm bg-muted">
        <div className={cn('h-full transition-[width]', tone)} style={{ width: `${clamped}%` }} />
      </div>
    </div>
  );
}
