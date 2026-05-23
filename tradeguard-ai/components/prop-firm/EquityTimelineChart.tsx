'use client';

/**
 * EOD equity vs. drawdown floor — 30-day window per profile.
 *
 * Recharts theming mirrors `HourlyWinRateChart` so the dashboards visually
 * agree. Warning days surface as red dots overlaid on the equity line; the
 * underlying line stays muted so the eye lands on the dots first.
 */

import { useMemo, type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  CartesianGrid,
  Dot,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
  type DotProps,
  type TooltipProps,
} from 'recharts';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { apiFetch } from '@/lib/api/client';
import type { UUID } from '@/types/db';

interface EquityTimelinePoint {
  date: string;
  eodEquity: number;
  drawdownFloor: number;
  dailyPnL: number;
  warningHit: boolean;
}

interface TimelineResponse {
  timeline: EquityTimelinePoint[];
}

interface EquityTimelineChartProps {
  profileId: UUID;
}

const TILT_GREEN = 'hsl(142, 76%, 36%)';
const TILT_RED = 'hsl(0, 84%, 60%)';
const MUTED = 'hsl(0, 0%, 60%)';
const BORDER = 'hsl(0, 0%, 18%)';
const TEXT_MUTED = 'hsl(0, 0%, 60%)';

function rangeIso(): { from: string; to: string } {
  const to = new Date();
  const from = new Date();
  from.setDate(from.getDate() - 30);
  return { from: from.toISOString(), to: to.toISOString() };
}

function CustomTooltip({ active, payload }: TooltipProps<number, string>): ReactNode {
  if (!active || !payload?.[0]) return null;
  const datum = payload[0].payload as EquityTimelinePoint;
  return (
    <div className="rounded-md border border-border bg-background px-3 py-2 text-xs shadow-lg">
      <p className="mb-1 font-medium text-foreground">{datum.date}</p>
      <p className="text-muted-foreground">
        EOD 자산:{' '}
        <span className="text-foreground tabular-nums">${datum.eodEquity.toFixed(0)}</span>
      </p>
      <p className="text-muted-foreground">
        드로우다운 바닥:{' '}
        <span className="text-foreground tabular-nums">${datum.drawdownFloor.toFixed(0)}</span>
      </p>
      <p className="text-muted-foreground">
        일 손익:{' '}
        <span
          className={
            datum.dailyPnL >= 0 ? 'text-tilt-green tabular-nums' : 'text-tilt-red tabular-nums'
          }
        >
          {datum.dailyPnL >= 0 ? '+' : ''}
          {datum.dailyPnL.toFixed(0)}
        </span>
      </p>
      {datum.warningHit ? <p className="text-tilt-red">⚠ 경고 발생일</p> : null}
    </div>
  );
}

interface WarningDotProps extends DotProps {
  payload?: EquityTimelinePoint;
}

function WarningDot(props: WarningDotProps): ReactNode {
  const { cx, cy, payload } = props;
  if (!payload?.warningHit || typeof cx !== 'number' || typeof cy !== 'number') {
    return <g />;
  }
  return <Dot cx={cx} cy={cy} r={4} fill={TILT_RED} stroke={TILT_RED} />;
}

export function EquityTimelineChart({ profileId }: EquityTimelineChartProps): ReactNode {
  const range = useMemo(() => rangeIso(), []);
  const { data, isLoading, error } = useQuery<TimelineResponse>({
    queryKey: ['prop-firm-profiles', profileId, 'timeline', range.from, range.to],
    queryFn: () =>
      apiFetch<TimelineResponse>(
        `/api/prop-firm-profiles/${profileId}/timeline?from=${encodeURIComponent(
          range.from,
        )}&to=${encodeURIComponent(range.to)}`,
      ),
  });

  const points = data?.timeline ?? [];

  return (
    <Card>
      <CardHeader>
        <CardTitle>30일 자산·드로우다운 추이</CardTitle>
      </CardHeader>
      <CardContent className="h-64 w-full p-2 lg:p-4">
        {error ? (
          <div className="flex h-full items-center justify-center text-sm text-tilt-red">
            시계열을 불러오지 못했습니다.
          </div>
        ) : isLoading ? (
          <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
            불러오는 중…
          </div>
        ) : points.length === 0 ? (
          <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
            표시할 데이터가 없습니다.
          </div>
        ) : (
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={points} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
              <CartesianGrid stroke={BORDER} strokeDasharray="2 4" vertical={false} />
              <XAxis
                dataKey="date"
                stroke={TEXT_MUTED}
                tick={{ fill: TEXT_MUTED, fontSize: 10 }}
                tickLine={false}
                axisLine={{ stroke: BORDER }}
                minTickGap={24}
              />
              <YAxis
                stroke={TEXT_MUTED}
                tick={{ fill: TEXT_MUTED, fontSize: 11 }}
                tickLine={false}
                axisLine={{ stroke: BORDER }}
                domain={['dataMin - 200', 'dataMax + 200']}
              />
              <Tooltip content={<CustomTooltip />} cursor={{ stroke: BORDER, strokeWidth: 1 }} />
              <Line
                type="monotone"
                dataKey="eodEquity"
                stroke={TILT_GREEN}
                strokeWidth={2}
                dot={<WarningDot />}
                activeDot={{ r: 4 }}
                isAnimationActive={false}
                name="EOD 자산"
              />
              <Line
                type="monotone"
                dataKey="drawdownFloor"
                stroke={MUTED}
                strokeWidth={1.5}
                strokeDasharray="3 3"
                dot={false}
                isAnimationActive={false}
                name="드로우다운 바닥"
              />
            </LineChart>
          </ResponsiveContainer>
        )}
      </CardContent>
    </Card>
  );
}
