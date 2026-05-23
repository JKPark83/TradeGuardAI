'use client';

/**
 * Risk score gauge.
 *
 * Inline SVG semicircle (180°) — no Recharts dep. The arc colour is tied to
 * the score band (0-39 green, 40-69 yellow, 70-100 red). A separate Tilt
 * colour badge sits beneath because Tilt is a *separate* dimension from the
 * computed risk score (e.g. Tilt=Red forces score≥70, but score≥70 doesn't
 * imply Tilt=Red).
 */

import type { ReactNode } from 'react';
import { cn } from '@/lib/utils/cn';
import type { TiltColor } from '@/types/db';

interface RiskScoreGaugeProps {
  score: number;
  tiltColor: TiltColor | 'absent';
}

type Band = 'low' | 'mid' | 'high';

function bandFor(score: number): Band {
  if (score >= 70) return 'high';
  if (score >= 40) return 'mid';
  return 'low';
}

const BAND_STROKE: Record<Band, string> = {
  low: 'stroke-tilt-green',
  mid: 'stroke-tilt-yellow',
  high: 'stroke-tilt-red',
};

const BAND_TEXT: Record<Band, string> = {
  low: 'text-tilt-green',
  mid: 'text-tilt-yellow',
  high: 'text-tilt-red',
};

const BAND_LABEL: Record<Band, string> = {
  low: '낮음',
  mid: '주의',
  high: '경고',
};

const TILT_LABEL: Record<TiltColor | 'absent', string> = {
  green: 'Tilt 안정',
  yellow: 'Tilt 주의',
  red: 'Tilt 경고',
  absent: 'Tilt 신호 없음',
};

const TILT_BADGE: Record<TiltColor | 'absent', string> = {
  green: 'border-tilt-green/50 bg-tilt-green/10 text-tilt-green',
  yellow: 'border-tilt-yellow/50 bg-tilt-yellow/10 text-tilt-yellow',
  red: 'border-tilt-red/60 bg-tilt-red/15 text-tilt-red',
  absent: 'border-border bg-muted/30 text-muted-foreground',
};

// Semicircle geometry — arc swept from 180° to 0° clockwise.
const SIZE = 180;
const CX = SIZE / 2;
const CY = SIZE / 2;
const R = 70;
const STROKE_W = 14;
// Half circumference (π·r). Score 0..100 maps onto this length.
const ARC_LEN = Math.PI * R;

export function RiskScoreGauge({ score, tiltColor }: RiskScoreGaugeProps): ReactNode {
  const clamped = Math.max(0, Math.min(100, Math.round(score)));
  const band = bandFor(clamped);
  const filledLen = (clamped / 100) * ARC_LEN;

  // Path: start at (CX-R, CY), arc to (CX+R, CY) along the top.
  const arcPath = `M ${CX - R} ${CY} A ${R} ${R} 0 0 1 ${CX + R} ${CY}`;

  return (
    <div className="flex flex-col items-center gap-3" role="img" aria-label={`위험도 ${clamped}`}>
      <svg width={SIZE} height={CY + STROKE_W} viewBox={`0 0 ${SIZE} ${CY + STROKE_W}`}>
        {/* Track */}
        <path
          d={arcPath}
          fill="none"
          strokeWidth={STROKE_W}
          strokeLinecap="round"
          className="stroke-muted/60"
        />
        {/* Filled arc — score progress */}
        <path
          d={arcPath}
          fill="none"
          strokeWidth={STROKE_W}
          strokeLinecap="round"
          className={cn(BAND_STROKE[band], 'transition-[stroke-dasharray] duration-300')}
          strokeDasharray={`${filledLen} ${ARC_LEN}`}
        />
        <text
          x={CX}
          y={CY - 8}
          textAnchor="middle"
          className={cn('font-mono text-5xl font-bold', BAND_TEXT[band])}
          fill="currentColor"
        >
          {clamped}
        </text>
        <text
          x={CX}
          y={CY + 14}
          textAnchor="middle"
          className="fill-muted-foreground text-[10px] uppercase tracking-wider"
        >
          / 100
        </text>
      </svg>

      <div className="flex flex-col items-center gap-1">
        <span className="text-xs uppercase tracking-wider text-muted-foreground">점수 근거</span>
        <div className="flex items-center gap-2">
          <span
            className={cn(
              'rounded-full border px-2 py-0.5 text-xs font-medium',
              band === 'low'
                ? 'border-tilt-green/50 bg-tilt-green/10 text-tilt-green'
                : band === 'mid'
                  ? 'border-tilt-yellow/50 bg-tilt-yellow/10 text-tilt-yellow'
                  : 'border-tilt-red/60 bg-tilt-red/15 text-tilt-red',
            )}
          >
            위험도 {BAND_LABEL[band]}
          </span>
          <span
            className={cn(
              'rounded-full border px-2 py-0.5 text-xs font-medium',
              TILT_BADGE[tiltColor],
            )}
          >
            {TILT_LABEL[tiltColor]}
          </span>
        </div>
      </div>
    </div>
  );
}
