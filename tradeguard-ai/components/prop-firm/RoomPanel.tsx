/**
 * Room panel — large headline numbers for the two rule-room metrics.
 *
 * Color buckets follow FR-022:
 *   - >50% room remaining → green
 *   - 20–50% room remaining → yellow
 *   - <20% room remaining → red
 * (Equivalently expressed as used-pct thresholds 50% / 80%.)
 *
 * When `currentRoom` is null the API has not yet computed values (no trades
 * uploaded for this account day). We surface that as a muted hint instead of
 * fake zeros, which would imply imminent violation.
 */

import type { ReactNode } from 'react';
import { cn } from '@/lib/utils/cn';
import type { PropFirmCurrentRoom } from '@/types/api';

interface RoomPanelProps {
  currentRoom: PropFirmCurrentRoom | null;
  profile: {
    dailyLossLimit: number | null;
    drawdownLimit: number;
  };
}

function toneFromUsedPct(usedPct: number | null): 'pos' | 'warn' | 'neg' {
  if (usedPct === null) return 'pos';
  if (usedPct >= 0.8) return 'neg';
  if (usedPct >= 0.5) return 'warn';
  return 'pos';
}

const TONE_TEXT: Record<'pos' | 'warn' | 'neg', string> = {
  pos: 'text-tilt-green',
  warn: 'text-tilt-yellow',
  neg: 'text-tilt-red',
};

const TONE_BAR: Record<'pos' | 'warn' | 'neg', string> = {
  pos: 'bg-tilt-green',
  warn: 'bg-tilt-yellow',
  neg: 'bg-tilt-red',
};

function formatMoney(n: number): string {
  const sign = n < 0 ? '-' : '';
  return `${sign}$${Math.abs(n).toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
}

export function RoomPanel({ currentRoom, profile }: RoomPanelProps): ReactNode {
  if (!currentRoom) {
    return (
      <div className="rounded-md border border-dashed border-border bg-muted/10 px-4 py-6 text-center text-sm text-muted-foreground">
        계산 중…
      </div>
    );
  }

  const dailyTone = toneFromUsedPct(currentRoom.dailyLossUsedPct);
  const drawdownUsedPct = 1 - currentRoom.drawdownRoom / profile.drawdownLimit;
  const drawdownTone = toneFromUsedPct(drawdownUsedPct);

  return (
    <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
      <Metric
        label="오늘 추가 허용 손실"
        value={
          currentRoom.dailyLossRoom !== null
            ? formatMoney(currentRoom.dailyLossRoom)
            : '한도 미설정'
        }
        tone={dailyTone}
        used={currentRoom.dailyLossUsedPct}
        sublabel={
          profile.dailyLossLimit !== null
            ? `한도 ${formatMoney(profile.dailyLossLimit)}`
            : '일일 손실 한도 미설정'
        }
      />
      <Metric
        label="드로우다운 여유"
        value={formatMoney(currentRoom.drawdownRoom)}
        tone={drawdownTone}
        used={drawdownUsedPct}
        sublabel={`바닥 ${formatMoney(currentRoom.drawdownFloor)} · 한도 ${formatMoney(
          profile.drawdownLimit,
        )}`}
      />
      <div className="md:col-span-2 grid grid-cols-2 gap-3 text-xs">
        <div className="flex items-center justify-between rounded-md border border-border bg-muted/20 px-3 py-2">
          <span className="text-muted-foreground">현재 자산</span>
          <span className="font-semibold tabular-nums">
            {formatMoney(currentRoom.currentEquity)}
          </span>
        </div>
        <div className="flex items-center justify-between rounded-md border border-border bg-muted/20 px-3 py-2">
          <span className="text-muted-foreground">드로우다운 바닥</span>
          <span className="font-semibold tabular-nums">
            {formatMoney(currentRoom.drawdownFloor)}
          </span>
        </div>
      </div>
    </div>
  );
}

interface MetricProps {
  label: string;
  value: string;
  sublabel: string;
  tone: 'pos' | 'warn' | 'neg';
  used: number | null;
}

function Metric({ label, value, sublabel, tone, used }: MetricProps): ReactNode {
  const pct = used === null ? 0 : Math.max(0, Math.min(1, used));
  return (
    <div className="flex flex-col gap-2 rounded-md border border-border bg-muted/20 p-4">
      <span className="text-xs uppercase tracking-wider text-muted-foreground">{label}</span>
      <span className={cn('text-3xl font-semibold tabular-nums', TONE_TEXT[tone])}>{value}</span>
      <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
        <div
          className={cn('h-full transition-all', TONE_BAR[tone])}
          style={{ width: `${pct * 100}%` }}
          aria-hidden
        />
      </div>
      <span className="text-xs text-muted-foreground">{sublabel}</span>
    </div>
  );
}
