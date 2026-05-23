'use client';

/**
 * Hourly win-rate chart — one bar per UTC hour (0–23).
 *
 * Recharts is configured for dark theme:
 *   - axis/grid use `--border` and `--muted-foreground` HSL channels (matching tailwind).
 *   - bar color encodes outcome (green ≥ 0.5 win rate, red < 0.5, muted when null).
 *
 * Hover tooltip surfaces the four contract fields verbatim (hourUtc, trades,
 * winRate, totalPnL) so the user can read the underlying numbers without
 * inferring from the bar height.
 */

import type { ReactNode } from 'react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
  type TooltipProps,
} from 'recharts';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import type { HourlyWinRateBucket } from '@/types/api';

interface HourlyWinRateChartProps {
  buckets: HourlyWinRateBucket[];
}

const TILT_GREEN = 'hsl(142, 76%, 36%)';
const TILT_RED = 'hsl(0, 84%, 60%)';
const MUTED = 'hsl(0, 0%, 30%)';
const BORDER = 'hsl(0, 0%, 18%)';
const TEXT_MUTED = 'hsl(0, 0%, 60%)';

function CustomTooltip({ active, payload }: TooltipProps<number, string>): ReactNode {
  if (!active || !payload?.[0]) return null;
  const datum = payload[0].payload as HourlyWinRateBucket;
  return (
    <div className="rounded-md border border-border bg-background px-3 py-2 text-xs shadow-lg">
      <p className="mb-1 font-medium text-foreground">{`${datum.hourUtc}시 (UTC)`}</p>
      <p className="text-muted-foreground">
        거래수: <span className="text-foreground tabular-nums">{datum.trades}</span>
      </p>
      <p className="text-muted-foreground">
        승률:{' '}
        <span className="text-foreground tabular-nums">
          {datum.winRate === null ? '—' : `${(datum.winRate * 100).toFixed(1)}%`}
        </span>
      </p>
      <p className="text-muted-foreground">
        손익:{' '}
        <span
          className={
            datum.totalPnL > 0
              ? 'text-tilt-green tabular-nums'
              : datum.totalPnL < 0
                ? 'text-tilt-red tabular-nums'
                : 'text-foreground tabular-nums'
          }
        >
          {datum.totalPnL > 0 ? '+' : ''}
          {datum.totalPnL.toFixed(2)}
        </span>
      </p>
    </div>
  );
}

function colorFor(b: HourlyWinRateBucket): string {
  if (b.winRate === null || b.trades === 0) return MUTED;
  return b.winRate >= 0.5 ? TILT_GREEN : TILT_RED;
}

export function HourlyWinRateChart({ buckets }: HourlyWinRateChartProps): ReactNode {
  // Y-axis value: use trade count primarily; null/0-trade bars naturally collapse.
  // (Win rate is encoded by bar color + tooltip.)
  return (
    <Card>
      <CardHeader>
        <CardTitle>시간대별 승률 (UTC)</CardTitle>
      </CardHeader>
      <CardContent className="h-64 w-full p-2 lg:p-4">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={buckets} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
            <CartesianGrid stroke={BORDER} strokeDasharray="2 4" vertical={false} />
            <XAxis
              dataKey="hourUtc"
              stroke={TEXT_MUTED}
              tick={{ fill: TEXT_MUTED, fontSize: 11 }}
              tickLine={false}
              axisLine={{ stroke: BORDER }}
              interval={1}
            />
            <YAxis
              stroke={TEXT_MUTED}
              tick={{ fill: TEXT_MUTED, fontSize: 11 }}
              tickLine={false}
              axisLine={{ stroke: BORDER }}
              allowDecimals={false}
            />
            <Tooltip
              content={<CustomTooltip />}
              cursor={{ fill: 'hsl(0, 0%, 12%)', fillOpacity: 0.4 }}
            />
            <Bar dataKey="trades" radius={[2, 2, 0, 0]}>
              {buckets.map((b) => (
                <Cell key={b.hourUtc} fill={colorFor(b)} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </CardContent>
    </Card>
  );
}
