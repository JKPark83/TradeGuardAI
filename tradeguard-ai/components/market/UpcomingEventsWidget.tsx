'use client';

/**
 * UpcomingEventsWidget — dashboard widget for upcoming macro events (US3).
 *
 * Hits `GET /api/market-context/upcoming-events?windowHours=48` and renders
 * the top 5 events sorted by scheduledAt (ascending). 5-minute stale time
 * keeps repeat dashboard visits cheap without hiding fresh CPI/FOMC adds.
 *
 * Impact tone maps to the project's tilt color palette so a "high"-impact
 * event reads visually the same as a red risk warning — intentional reuse.
 */

import { useMemo, type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { CalendarClock } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { apiFetch } from '@/lib/api/client';
import { cn } from '@/lib/utils/cn';
import type { EventType } from '@/types/db';

type ImpactLevel = 'low' | 'medium' | 'high';

interface UpcomingEvent {
  type: EventType | string;
  scheduledAt: string;
  country: string;
  expectedImpact: ImpactLevel;
}

interface UpcomingEventsResponse {
  events: UpcomingEvent[];
}

const EVENT_LABEL: Record<string, string> = {
  cpi: 'CPI 발표',
  fomc: 'FOMC',
  nfp: 'NFP',
  cbproductivity: '생산성지표',
  normal: '일반',
};

const IMPACT_TONE: Record<ImpactLevel, string> = {
  high: 'text-tilt-red border-tilt-red/40 bg-tilt-red/10',
  medium: 'text-tilt-yellow border-tilt-yellow/40 bg-tilt-yellow/10',
  low: 'text-muted-foreground border-border bg-muted/30',
};

const IMPACT_LABEL: Record<ImpactLevel, string> = {
  high: '높음',
  medium: '중간',
  low: '낮음',
};

function eventLabel(type: string): string {
  return EVENT_LABEL[type] ?? type.toUpperCase();
}

function formatTimeUntil(scheduledAt: string, now: number): string {
  const diffMs = new Date(scheduledAt).getTime() - now;
  if (Number.isNaN(diffMs)) return '—';
  if (diffMs <= 0) return '진행 중/지남';
  const totalMin = Math.round(diffMs / 60_000);
  if (totalMin < 60) return `${totalMin}분 후`;
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  if (h < 24) return m > 0 ? `${h}시간 ${m}분 후` : `${h}시간 후`;
  const d = Math.floor(h / 24);
  const remH = h % 24;
  return remH > 0 ? `${d}일 ${remH}시간 후` : `${d}일 후`;
}

function formatLocalTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString('ko-KR', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function UpcomingEventsWidget(): ReactNode {
  const { data, isLoading, error } = useQuery<UpcomingEventsResponse>({
    queryKey: ['market', 'upcoming-events', 48],
    queryFn: () =>
      apiFetch<UpcomingEventsResponse>('/api/market-context/upcoming-events?windowHours=48'),
    staleTime: 5 * 60 * 1000,
  });

  const top = useMemo(() => {
    const events = data?.events ?? [];
    return [...events]
      .sort((a, b) => new Date(a.scheduledAt).getTime() - new Date(b.scheduledAt).getTime())
      .slice(0, 5);
  }, [data]);

  const now = Date.now();

  return (
    <Card>
      <CardHeader className="flex flex-row items-center gap-2">
        <CalendarClock className="h-4 w-4 text-muted-foreground" aria-hidden />
        <CardTitle>다가오는 이벤트</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-2">
        {isLoading ? (
          <p className="text-xs text-muted-foreground">불러오는 중…</p>
        ) : error ? (
          <p className="text-xs text-tilt-red">이벤트 일정을 불러오지 못했습니다.</p>
        ) : top.length === 0 ? (
          <p className="text-xs text-muted-foreground">다가오는 주요 경제 이벤트 없음</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {top.map((ev) => {
              const impact: ImpactLevel = (['low', 'medium', 'high'] as ImpactLevel[]).includes(
                ev.expectedImpact,
              )
                ? ev.expectedImpact
                : 'low';
              return (
                <li
                  key={`${ev.type}-${ev.scheduledAt}`}
                  className="flex items-center justify-between gap-3 rounded-md border border-border bg-background/40 px-3 py-2"
                >
                  <div className="flex flex-col gap-0.5 min-w-0">
                    <span className="truncate text-sm font-medium text-foreground">
                      {eventLabel(ev.type)}{' '}
                      <span className="text-xs text-muted-foreground">· {ev.country}</span>
                    </span>
                    <span className="text-xs tabular-nums text-muted-foreground">
                      {formatLocalTime(ev.scheduledAt)} · {formatTimeUntil(ev.scheduledAt, now)}
                    </span>
                  </div>
                  <span
                    className={cn(
                      'shrink-0 rounded-sm border px-1.5 py-0.5 text-[11px]',
                      IMPACT_TONE[impact],
                    )}
                  >
                    {IMPACT_LABEL[impact]}
                  </span>
                </li>
              );
            })}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
