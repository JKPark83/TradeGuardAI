/**
 * Warning banner.
 *
 * Renders a coloured banner only when the score crosses the actionable
 * thresholds. Hidden below 50 so the UI stays calm during low-risk
 * candidates — the gauge alone communicates the state.
 */

import { AlertOctagon, AlertTriangle } from 'lucide-react';
import type { ReactNode } from 'react';
import { cn } from '@/lib/utils/cn';

interface WarningBannerProps {
  riskScore: number;
  warningMessage: string | null;
}

export function WarningBanner({ riskScore, warningMessage }: WarningBannerProps): ReactNode {
  if (riskScore < 50) return null;

  const isHigh = riskScore >= 70;
  const Icon = isHigh ? AlertOctagon : AlertTriangle;

  return (
    <div
      role="alert"
      className={cn(
        'flex items-start gap-3 rounded-md border px-4 py-3',
        isHigh
          ? 'border-tilt-red/60 bg-tilt-red/10 text-tilt-red'
          : 'border-tilt-yellow/60 bg-tilt-yellow/10 text-tilt-yellow',
      )}
    >
      <Icon className="mt-0.5 h-5 w-5 shrink-0" aria-hidden />
      <div className="flex flex-col gap-1">
        <span className="text-sm font-semibold">
          {isHigh ? '진입 비권장 — 위험도 70 이상' : '주의 — 위험도 50 이상'}
        </span>
        {warningMessage ? (
          <span className={cn('text-xs', isHigh ? 'text-tilt-red/90' : 'text-tilt-yellow/90')}>
            {warningMessage}
          </span>
        ) : null}
      </div>
    </div>
  );
}
