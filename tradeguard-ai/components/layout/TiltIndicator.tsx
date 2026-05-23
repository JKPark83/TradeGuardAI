'use client';

/**
 * Header tilt status indicator.
 *
 * Polls `/api/sessions/active` via TanStack Query (cached for 30s by the
 * shared QueryClient defaults). Renders one of:
 *   - "세션 없음" muted (no active session)
 *   - "체크인 필요" yellow warning (active session but no tilt check)
 *   - colored dot + Tilt label (active session with tilt check)
 *
 * Polling cadence is light because the dashboard's other queries also share
 * `staleTime: 30_000`. We rely on mutation invalidations from SessionPanel /
 * TiltCheckinForm to refresh immediately after user actions.
 */

import { type ReactNode } from 'react';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { apiFetch } from '@/lib/api/client';
import { cn } from '@/lib/utils/cn';
import type { ActiveSessionResponse } from '@/types/api';
import type { TiltColor } from '@/types/db';

const COLOR_DOT: Record<TiltColor, string> = {
  green: 'bg-tilt-green',
  yellow: 'bg-tilt-yellow',
  red: 'bg-tilt-red',
};

const COLOR_TEXT: Record<TiltColor, string> = {
  green: 'text-tilt-green',
  yellow: 'text-tilt-yellow',
  red: 'text-tilt-red',
};

const COLOR_LABEL: Record<TiltColor, string> = {
  green: '안정',
  yellow: '주의',
  red: '경고',
};

export function TiltIndicator(): ReactNode {
  const { data, isLoading } = useQuery<ActiveSessionResponse>({
    queryKey: ['session', 'active'],
    queryFn: () => apiFetch<ActiveSessionResponse>('/api/sessions/active'),
  });

  if (isLoading) {
    return (
      <span className="text-muted-foreground text-xs" aria-label="Tilt 상태 로딩 중">
        Tilt: …
      </span>
    );
  }

  const session = data?.activeSession ?? null;

  if (!session) {
    return (
      <Link
        href="/session"
        className="text-muted-foreground text-xs hover:text-foreground"
        aria-label="세션 없음 — 시작하기"
      >
        Tilt: 세션 없음
      </Link>
    );
  }

  if (!session.tiltCheck) {
    return (
      <Link
        href="/session"
        className={cn(
          'inline-flex items-center gap-1.5 rounded-full border border-tilt-yellow/40',
          'bg-tilt-yellow/10 px-2 py-0.5 text-xs text-tilt-yellow hover:bg-tilt-yellow/20',
        )}
        aria-label="멘탈 체크인이 필요합니다"
      >
        <span className="inline-block h-2 w-2 rounded-full bg-tilt-yellow" aria-hidden />
        Tilt: 체크인 필요
      </Link>
    );
  }

  const color = session.tiltCheck.color;
  return (
    <Link
      href="/session"
      className="inline-flex items-center gap-1.5 text-xs hover:opacity-80"
      aria-label={`Tilt 상태 ${COLOR_LABEL[color]}`}
    >
      <span className={cn('inline-block h-2 w-2 rounded-full', COLOR_DOT[color])} aria-hidden />
      <span className={cn('font-medium', COLOR_TEXT[color])}>Tilt: {COLOR_LABEL[color]}</span>
    </Link>
  );
}
