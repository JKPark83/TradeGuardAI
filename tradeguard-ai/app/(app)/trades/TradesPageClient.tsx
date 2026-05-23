'use client';

/**
 * Trades list client.
 *
 * Owns filter state (symbol, date range, status) and feeds them into a single
 * `useQuery` keyed by the filter tuple — so toggling any filter triggers a
 * cache-aware refetch instead of an imperative API call. The summary tiles
 * read from the same response payload (`summary` field) to stay consistent.
 */

import { useMemo, useState, type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Card, CardContent } from '@/components/ui/card';
import { Input, Label, Select } from '@/components/ui/form';
import { TradesTable } from '@/components/trades/TradesTable';
import { MarketBackfillButton } from '@/components/market/MarketBackfillButton';
import { apiFetch } from '@/lib/api/client';
import { cn } from '@/lib/utils/cn';
import type { TradesListResponse } from '@/types/api';

type StatusFilter = 'all' | 'open' | 'closed';

interface Filters {
  symbol: string;
  from: string;
  to: string;
  status: StatusFilter;
}

function buildTradesUrl(f: Filters): string {
  const params = new URLSearchParams();
  params.set('limit', '50');
  if (f.symbol.trim()) params.set('symbol', f.symbol.trim());
  if (f.from) params.set('from', new Date(f.from).toISOString());
  if (f.to) params.set('to', new Date(f.to).toISOString());
  if (f.status !== 'all') params.set('status', f.status);
  return `/api/trades?${params.toString()}`;
}

function formatPnl(n: number): string {
  const sign = n > 0 ? '+' : '';
  return `${sign}${n.toFixed(2)}`;
}

function formatWinRate(r: number): string {
  return `${(r * 100).toFixed(1)}%`;
}

export function TradesPageClient(): ReactNode {
  const [filters, setFilters] = useState<Filters>({
    symbol: '',
    from: '',
    to: '',
    status: 'all',
  });

  const url = useMemo(() => buildTradesUrl(filters), [filters]);

  const { data, isLoading, error } = useQuery<TradesListResponse>({
    queryKey: ['trades', filters],
    queryFn: () => apiFetch<TradesListResponse>(url),
  });

  const summary = data?.summary;
  const trades = data?.trades ?? [];

  return (
    <div className="flex flex-col gap-4">
      <div className="flex justify-end">
        <MarketBackfillButton />
      </div>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <SummaryTile label="총 거래" value={summary ? String(summary.total) : '—'} />
        <SummaryTile label="승률" value={summary ? formatWinRate(summary.winRate) : '—'} />
        <SummaryTile
          label="누적 손익"
          value={summary ? formatPnl(summary.totalPnL) : '—'}
          tone={summary ? (summary.totalPnL >= 0 ? 'pos' : 'neg') : 'neutral'}
        />
        <SummaryTile
          label="평균 보유시간"
          value={trades.length > 0 ? avgHoldingLabel(trades) : '—'}
        />
      </div>

      <Card>
        <CardContent className="grid grid-cols-1 gap-3 p-4 md:grid-cols-4 lg:p-6">
          <div className="flex flex-col gap-1">
            <Label htmlFor="f-symbol">종목</Label>
            <Input
              id="f-symbol"
              placeholder="예: NQ"
              value={filters.symbol}
              onChange={(e) => setFilters((p) => ({ ...p, symbol: e.target.value }))}
            />
          </div>
          <div className="flex flex-col gap-1">
            <Label htmlFor="f-from">시작일</Label>
            <Input
              id="f-from"
              type="date"
              value={filters.from}
              onChange={(e) => setFilters((p) => ({ ...p, from: e.target.value }))}
            />
          </div>
          <div className="flex flex-col gap-1">
            <Label htmlFor="f-to">종료일</Label>
            <Input
              id="f-to"
              type="date"
              value={filters.to}
              onChange={(e) => setFilters((p) => ({ ...p, to: e.target.value }))}
            />
          </div>
          <div className="flex flex-col gap-1">
            <Label htmlFor="f-status">상태</Label>
            <Select
              id="f-status"
              value={filters.status}
              onChange={(e) =>
                setFilters((p) => ({ ...p, status: e.target.value as StatusFilter }))
              }
            >
              <option value="all">전체</option>
              <option value="open">미청산</option>
              <option value="closed">청산</option>
            </Select>
          </div>
        </CardContent>
      </Card>

      {error ? (
        <div className="rounded-md border border-tilt-red/40 bg-tilt-red/10 px-3 py-2 text-sm text-tilt-red">
          거래 목록을 불러오지 못했습니다.
        </div>
      ) : null}

      {isLoading ? (
        <div className="rounded-md border border-dashed border-border bg-muted/10 p-6 text-center text-sm text-muted-foreground">
          불러오는 중…
        </div>
      ) : (
        <TradesTable trades={trades} />
      )}
    </div>
  );
}

interface SummaryTileProps {
  label: string;
  value: string;
  tone?: 'pos' | 'neg' | 'neutral';
}

function SummaryTile({ label, value, tone = 'neutral' }: SummaryTileProps): ReactNode {
  return (
    <Card>
      <CardContent className="flex flex-col gap-1 p-4">
        <span className="text-xs uppercase tracking-wider text-muted-foreground">{label}</span>
        <span
          className={cn(
            'text-lg font-semibold tabular-nums',
            tone === 'pos' && 'text-tilt-green',
            tone === 'neg' && 'text-tilt-red',
          )}
        >
          {value}
        </span>
      </CardContent>
    </Card>
  );
}

function avgHoldingLabel(trades: { entryAt: string; exitAt: string | null }[]): string {
  const closed = trades.filter((t) => t.exitAt);
  if (closed.length === 0) return '—';
  const totalMin = closed.reduce((sum, t) => {
    const ms = new Date(t.exitAt as string).getTime() - new Date(t.entryAt).getTime();
    return sum + Math.max(0, Math.round(ms / 60_000));
  }, 0);
  const avg = Math.round(totalMin / closed.length);
  const h = Math.floor(avg / 60);
  const m = avg % 60;
  return h > 0 ? `${h}시간 ${m}분` : `${m}분`;
}
