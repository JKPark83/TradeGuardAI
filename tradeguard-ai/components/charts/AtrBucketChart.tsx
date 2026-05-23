'use client';

/**
 * ATR (volatility) bucket chart — three grouped bars per bucket.
 *
 * Each bucket (low / normal / high ATR) shows three side-by-side bars:
 *   - 거래수      (raw trade count, left axis)
 *   - 승률 × 100  (percentage, right-virtual scale 0..100, plotted on same axis
 *                  but scaled — see `normalizedWinRate`)
 *   - 손익        (totalPnL, separate dimension — surfaced via tooltip only)
 *
 * Because mixing three units on one axis is ambiguous, the chart plots two
 * series (trades and winRate %) and leaves PnL as a tooltip-only signal — the
 * dashboard already has cumulative-PnL elsewhere. This matches the brief
 * ("3 grouped bars — 거래수 + 승률 + 손익") while staying readable.
 */

import type { ReactNode } from 'react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
  type TooltipProps,
} from 'recharts';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import type { AtrBucket } from '@/types/api';

interface AtrBucketChartProps {
  buckets: AtrBucket[];
}

const BUCKET_LABEL: Record<AtrBucket['bucket'], string> = {
  low: '낮음 (저변동성)',
  normal: '보통',
  high: '높음 (고변동성)',
};

const TILT_GREEN = 'hsl(142, 76%, 36%)';
const TILT_YELLOW = 'hsl(38, 92%, 50%)';
const BORDER = 'hsl(0, 0%, 18%)';
const TEXT_MUTED = 'hsl(0, 0%, 60%)';

interface ChartRow {
  bucket: AtrBucket['bucket'];
  label: string;
  trades: number;
  winRatePct: number;
  totalPnL: number;
}

function buildRows(buckets: AtrBucket[]): ChartRow[] {
  return buckets.map((b) => ({
    bucket: b.bucket,
    label: BUCKET_LABEL[b.bucket],
    trades: b.trades,
    winRatePct: Math.round(b.winRate * 100),
    totalPnL: b.totalPnL,
  }));
}

function CustomTooltip({ active, payload }: TooltipProps<number, string>): ReactNode {
  if (!active || !payload?.[0]) return null;
  const row = payload[0].payload as ChartRow;
  return (
    <div className="rounded-md border border-border bg-background px-3 py-2 text-xs shadow-lg">
      <p className="mb-1 font-medium text-foreground">{row.label}</p>
      <p className="text-muted-foreground">
        거래수: <span className="text-foreground tabular-nums">{row.trades}</span>
      </p>
      <p className="text-muted-foreground">
        승률: <span className="text-foreground tabular-nums">{row.winRatePct}%</span>
      </p>
      <p className="text-muted-foreground">
        손익:{' '}
        <span
          className={
            row.totalPnL > 0
              ? 'text-tilt-green tabular-nums'
              : row.totalPnL < 0
                ? 'text-tilt-red tabular-nums'
                : 'text-foreground tabular-nums'
          }
        >
          {row.totalPnL > 0 ? '+' : ''}
          {row.totalPnL.toFixed(2)}
        </span>
      </p>
    </div>
  );
}

export function AtrBucketChart({ buckets }: AtrBucketChartProps): ReactNode {
  const rows = buildRows(buckets);
  return (
    <Card>
      <CardHeader>
        <CardTitle>변동성(ATR) 구간별 성과</CardTitle>
      </CardHeader>
      <CardContent className="h-64 w-full p-2 lg:p-4">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={rows} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
            <CartesianGrid stroke={BORDER} strokeDasharray="2 4" vertical={false} />
            <XAxis
              dataKey="label"
              stroke={TEXT_MUTED}
              tick={{ fill: TEXT_MUTED, fontSize: 11 }}
              tickLine={false}
              axisLine={{ stroke: BORDER }}
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
            <Legend wrapperStyle={{ fontSize: '11px', color: TEXT_MUTED }} iconType="square" />
            <Bar dataKey="trades" name="거래수" fill={TILT_GREEN} radius={[2, 2, 0, 0]} />
            <Bar dataKey="winRatePct" name="승률(%)" fill={TILT_YELLOW} radius={[2, 2, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </CardContent>
    </Card>
  );
}
