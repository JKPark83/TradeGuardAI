/**
 * Risk breakdown — horizontal bars for the 5 risk signals.
 *
 * Each row shows: Korean label, weight %, raw value (0-100), and the weighted
 * contribution (= raw × weight). Null signals (Tilt absent, no Prop Firm
 * profile) render a greyed-out track to communicate "신호 없음" without
 * collapsing the layout — the user must see *which* signal is missing.
 */

import type { ReactNode } from 'react';
import { cn } from '@/lib/utils/cn';
import type { RiskAssessmentSignals, RiskAssessmentWeights } from '@/types/db';

interface RiskBreakdownProps {
  signalsBreakdown: RiskAssessmentSignals;
  weights: RiskAssessmentWeights;
}

type SignalKey = keyof RiskAssessmentSignals;

const LABEL: Record<SignalKey, string> = {
  recentPnlStreak: '직전 손익 흐름',
  marketContext: '시장 컨텍스트',
  similarHistoryLossRate: '유사 과거 패턴',
  tilt: 'Tilt 상태',
  propFirmRoom: 'Prop Firm 룰 여유',
};

const ORDER: SignalKey[] = [
  'recentPnlStreak',
  'marketContext',
  'similarHistoryLossRate',
  'tilt',
  'propFirmRoom',
];

function barColor(value: number): string {
  if (value >= 70) return 'bg-tilt-red';
  if (value >= 40) return 'bg-tilt-yellow';
  return 'bg-tilt-green';
}

interface RowProps {
  label: string;
  weightPct: number;
  raw: number | null;
}

function SignalRow({ label, weightPct, raw }: RowProps): ReactNode {
  const isAbsent = raw === null;
  const clamped = isAbsent ? 0 : Math.max(0, Math.min(100, raw));
  const weighted = isAbsent ? 0 : Math.round(clamped * weightPct) / 100;
  const widthPct = isAbsent ? 100 : clamped;

  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-baseline justify-between gap-2">
        <div className="flex items-baseline gap-2">
          <span className="text-sm font-medium text-foreground">{label}</span>
          <span className="text-[10px] uppercase tracking-wider text-muted-foreground">
            가중치 {Math.round(weightPct * 100)}%
          </span>
        </div>
        <span
          className={cn(
            'font-mono text-xs tabular-nums',
            isAbsent ? 'text-muted-foreground' : 'text-foreground',
          )}
        >
          {isAbsent ? '— / 100' : `${clamped} / 100`}
          {!isAbsent ? (
            <span className="ml-2 text-muted-foreground">기여 {weighted.toFixed(1)}</span>
          ) : null}
        </span>
      </div>
      <div
        className={cn(
          'h-2 w-full overflow-hidden rounded-full',
          isAbsent ? 'bg-muted/20' : 'bg-muted/40',
        )}
        role="progressbar"
        aria-label={label}
        aria-valuenow={isAbsent ? 0 : clamped}
        aria-valuemin={0}
        aria-valuemax={100}
      >
        <div
          className={cn(
            'h-full rounded-full transition-[width] duration-300',
            isAbsent ? 'bg-muted/40' : barColor(clamped),
          )}
          style={{ width: `${widthPct}%` }}
        />
      </div>
      {isAbsent ? (
        <span className="text-[11px] text-muted-foreground">신호 없음 — 가중치 재분배됨</span>
      ) : null}
    </div>
  );
}

export function RiskBreakdown({ signalsBreakdown, weights }: RiskBreakdownProps): ReactNode {
  return (
    <div className="flex flex-col gap-4">
      {ORDER.map((key) => (
        <SignalRow
          key={key}
          label={LABEL[key]}
          weightPct={weights[key]}
          raw={signalsBreakdown[key]}
        />
      ))}
    </div>
  );
}
