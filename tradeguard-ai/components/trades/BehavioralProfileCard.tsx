/**
 * Behavioral profile card grid.
 *
 * Renders the six profile aggregates as discrete tiles. Each tile uses the
 * same density/typography as the trades summary tiles to keep the dashboard
 * visually consistent. Coloring is intentionally muted — the dashboard is
 * for diagnosis, not alarm; high-tilt UI is reserved for the live session
 * indicator (US6).
 */

import type { ReactNode } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { cn } from '@/lib/utils/cn';
import type { BehavioralProfileResponse } from '@/types/api';

interface BehavioralProfileCardProps {
  profile: BehavioralProfileResponse;
}

interface Metric {
  label: string;
  value: string;
  hint?: string;
  tone?: 'pos' | 'neg' | 'warn' | 'neutral';
}

function scoreTone(score: number): Metric['tone'] {
  if (score >= 70) return 'neg';
  if (score >= 40) return 'warn';
  return 'pos';
}

function buildMetrics(p: BehavioralProfileResponse): Metric[] {
  return [
    { label: '총 거래수', value: String(p.totalTrades) },
    {
      label: '평균 손절 지연 점수',
      value: p.avgStopDelayScore.toFixed(1),
      hint: '높을수록 손절을 미루는 경향',
      tone: scoreTone(p.avgStopDelayScore),
    },
    {
      label: '평균 복구매매 간격',
      value: `${p.avgRevengeTradeGapMinutes.toFixed(1)}분`,
      hint: '짧을수록 감정적 재진입 가능성',
      tone:
        p.avgRevengeTradeGapMinutes < 15
          ? 'neg'
          : p.avgRevengeTradeGapMinutes < 30
            ? 'warn'
            : 'pos',
    },
    {
      label: '최대 연속 손실',
      value: `${p.maxLossStreak}회`,
      tone: p.maxLossStreak >= 5 ? 'neg' : p.maxLossStreak >= 3 ? 'warn' : 'neutral',
    },
    {
      label: '야간 매매 비율',
      value: `${(p.nightTradingRatio * 100).toFixed(1)}%`,
      hint: '02–07시 KST 기준',
      tone: p.nightTradingRatio >= 0.3 ? 'warn' : 'neutral',
    },
    {
      label: '확신 과다 점수',
      value: p.overconfidenceScore.toFixed(1),
      tone: scoreTone(p.overconfidenceScore),
    },
  ];
}

function toneClass(tone: Metric['tone']): string {
  switch (tone) {
    case 'pos':
      return 'text-tilt-green';
    case 'neg':
      return 'text-tilt-red';
    case 'warn':
      return 'text-tilt-yellow';
    default:
      return 'text-foreground';
  }
}

export function BehavioralProfileCard({ profile }: BehavioralProfileCardProps): ReactNode {
  const metrics = buildMetrics(profile);

  return (
    <Card>
      <CardHeader className="flex flex-row items-baseline justify-between">
        <CardTitle>행동 프로파일</CardTitle>
        <span className="text-xs text-muted-foreground">
          최근 갱신:{' '}
          <span className="text-foreground">
            {profile.lastRecomputedAt.replace('T', ' ').slice(0, 16)}
          </span>
        </span>
      </CardHeader>
      <CardContent className="grid grid-cols-2 gap-4 md:grid-cols-3">
        {metrics.map((m) => (
          <div key={m.label} className="flex flex-col gap-1">
            <span className="text-xs uppercase tracking-wider text-muted-foreground">
              {m.label}
            </span>
            <span className={cn('text-lg font-semibold tabular-nums', toneClass(m.tone))}>
              {m.value}
            </span>
            {m.hint ? <span className="text-xs text-muted-foreground/80">{m.hint}</span> : null}
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
