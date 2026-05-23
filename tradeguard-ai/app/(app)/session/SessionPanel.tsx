'use client';

/**
 * Session control panel.
 *
 * Three states:
 *   1. No active session → "세션 시작" CTA → POST /api/sessions
 *   2. Active session without tilt check → embed `<TiltCheckinForm />`
 *   3. Active session with tilt check → show color + recommendations + "세션 종료"
 *
 * `initialActive` is the server-fetched snapshot so the first paint shows the
 * correct state; TanStack Query then takes over for cache + invalidation.
 */

import { useMemo, type ReactNode } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { TiltCheckinForm } from '@/components/session/TiltCheckinForm';
import { apiFetch } from '@/lib/api/client';
import { cn } from '@/lib/utils/cn';
import type { ActiveSessionResponse } from '@/types/api';
import type { TiltColor } from '@/types/db';

interface SessionPanelProps {
  initialActive: ActiveSessionResponse;
}

interface CreateSessionResponse {
  sessionId: string;
  startedAt: string;
  tiltCheck: { color: TiltColor; submittedAt: string } | null;
}

interface EndSessionResponse {
  sessionId: string;
  endedAt: string;
  tradesInSession: number;
}

const COLOR_LABEL: Record<TiltColor, string> = {
  green: '안정',
  yellow: '주의',
  red: '경고',
};

const COLOR_DOT: Record<TiltColor, string> = {
  green: 'bg-tilt-green',
  yellow: 'bg-tilt-yellow',
  red: 'bg-tilt-red',
};

function recommendationsFor(color: TiltColor): string[] {
  if (color === 'red') {
    return ['거래 중단 권고', '사이즈 50% 이하 감소', '최소 1시간 휴식 후 재평가'];
  }
  if (color === 'yellow') {
    return ['사이즈 50% 감소 권고', '진입 빈도 줄이기'];
  }
  return ['평소 운용 가능', '계획된 진입 규칙 준수'];
}

export function SessionPanel({ initialActive }: SessionPanelProps): ReactNode {
  const qc = useQueryClient();

  const { data: active } = useQuery<ActiveSessionResponse>({
    queryKey: ['session', 'active'],
    queryFn: () => apiFetch<ActiveSessionResponse>('/api/sessions/active'),
    initialData: initialActive,
  });

  const startMutation = useMutation<CreateSessionResponse, Error, { force?: boolean }>({
    mutationFn: (vars) =>
      apiFetch<CreateSessionResponse>('/api/sessions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(vars),
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['session', 'active'] });
    },
  });

  const endMutation = useMutation<EndSessionResponse, Error, string>({
    mutationFn: (sessionId) =>
      apiFetch<EndSessionResponse>(`/api/sessions/${sessionId}/end`, { method: 'PATCH' }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['session', 'active'] });
    },
  });

  const sessionInfo = active.activeSession;

  const startedAtLabel = useMemo(() => {
    if (!sessionInfo) return null;
    try {
      return new Date(sessionInfo.startedAt).toLocaleString('ko-KR');
    } catch {
      return sessionInfo.startedAt;
    }
  }, [sessionInfo]);

  if (!sessionInfo) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>활성 세션 없음</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <p className="text-sm text-muted-foreground">
            새 거래 세션을 시작하고 멘탈 체크인을 진행해 주세요.
          </p>
          <Button
            onClick={() => startMutation.mutate({})}
            disabled={startMutation.isPending}
            className="self-start"
          >
            {startMutation.isPending ? '시작 중…' : '거래 세션 시작'}
          </Button>
          {startMutation.error ? (
            <p className="text-xs text-tilt-red">세션 시작에 실패했습니다.</p>
          ) : null}
        </CardContent>
      </Card>
    );
  }

  if (!sessionInfo.tiltCheck) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>멘탈 체크인 (30초)</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <p className="text-xs text-muted-foreground">세션 시작 시각: {startedAtLabel}</p>
          <TiltCheckinForm sessionId={sessionInfo.id} />
        </CardContent>
      </Card>
    );
  }

  const color = sessionInfo.tiltCheck.color;
  return (
    <Card>
      <CardHeader>
        <CardTitle>활성 세션</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <div className="flex items-center gap-3">
          <span className={cn('inline-block h-3 w-3 rounded-full', COLOR_DOT[color])} aria-hidden />
          <span className={cn('text-sm font-semibold', `text-tilt-${color}`)}>
            Tilt: {COLOR_LABEL[color]} ({color.toUpperCase()})
          </span>
        </div>
        <p className="text-xs text-muted-foreground">시작 시각: {startedAtLabel}</p>
        <div className="flex flex-col gap-1">
          <span className="text-xs uppercase tracking-wider text-muted-foreground">권장 사항</span>
          <ul className="list-disc pl-5 text-sm">
            {recommendationsFor(color).map((r) => (
              <li key={r}>{r}</li>
            ))}
          </ul>
        </div>
        <div className="flex gap-2">
          <Button
            variant="destructive"
            onClick={() => endMutation.mutate(sessionInfo.id)}
            disabled={endMutation.isPending}
          >
            {endMutation.isPending ? '종료 중…' : '세션 종료'}
          </Button>
        </div>
        {endMutation.error ? (
          <p className="text-xs text-tilt-red">세션 종료에 실패했습니다.</p>
        ) : null}
      </CardContent>
    </Card>
  );
}
