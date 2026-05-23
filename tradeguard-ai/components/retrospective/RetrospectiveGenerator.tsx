'use client';

/**
 * RetrospectiveGenerator — single-trade AI retrospective trigger + renderer.
 *
 * Wraps the `POST /api/analysis/retrospective` call (single-trade form) with
 * an explicit state machine: idle → loading → success | filtered_out | error.
 * We branch on `ApiClientError.status === 422` to distinguish tone-filter
 * rejection from network/server errors — the spec (FR-009) calls for an
 * actionable "재시도" affordance only on the filter-failure path.
 *
 * `regenerate: true` is reserved for the explicit "재생성" button so we never
 * silently re-charge tokens on initial load.
 */

import { useCallback, useState, type ReactNode } from 'react';
import { AlertTriangle, RefreshCw, Sparkles } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { RetrospectiveCard } from './RetrospectiveCard';
import { apiFetch, ApiClientError } from '@/lib/api/client';
import type { RetrospectiveResponse } from '@/types/api';
import type { UUID } from '@/types/db';

interface RetrospectiveGeneratorProps {
  tradeId: UUID;
}

type GeneratorState =
  | { kind: 'idle' }
  | { kind: 'loading' }
  | { kind: 'success'; response: RetrospectiveResponse }
  | { kind: 'filtered_out'; attemptsUsed?: number }
  | { kind: 'error'; message: string };

export function RetrospectiveGenerator({ tradeId }: RetrospectiveGeneratorProps): ReactNode {
  const [state, setState] = useState<GeneratorState>({ kind: 'idle' });

  const generate = useCallback(
    async (regenerate: boolean): Promise<void> => {
      setState({ kind: 'loading' });
      try {
        const res = await apiFetch<RetrospectiveResponse>('/api/analysis/retrospective', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ tradeId, regenerate }),
        });
        setState({ kind: 'success', response: res });
      } catch (err) {
        if (err instanceof ApiClientError && err.status === 422) {
          const attempts = err.body['attemptsUsed'];
          setState({
            kind: 'filtered_out',
            attemptsUsed: typeof attempts === 'number' ? attempts : undefined,
          });
          return;
        }
        const message = err instanceof Error ? err.message : '회고 생성 중 오류가 발생했습니다.';
        setState({ kind: 'error', message });
      }
    },
    [tradeId],
  );

  if (state.kind === 'idle') {
    return (
      <Button
        variant="outline"
        size="sm"
        onClick={() => void generate(false)}
        aria-label="회고 생성"
      >
        <Sparkles className="h-3.5 w-3.5" aria-hidden /> 회고 생성
      </Button>
    );
  }

  if (state.kind === 'loading') {
    return (
      <div
        role="status"
        aria-live="polite"
        className="flex items-center gap-2 rounded-md border border-border bg-muted/20 px-3 py-2 text-xs text-muted-foreground"
      >
        <Sparkles className="h-3.5 w-3.5 animate-pulse text-tilt-green" aria-hidden />
        <span>AI 분석 중... (5~10초 소요)</span>
      </div>
    );
  }

  if (state.kind === 'filtered_out') {
    return (
      <Card>
        <CardHeader className="flex flex-row items-center gap-2">
          <AlertTriangle className="h-4 w-4 text-tilt-yellow" aria-hidden />
          <CardTitle>회고 톤 필터 실패 — 재시도</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <p className="text-sm text-muted-foreground">
            회고 톤이 기준에 맞지 않아 차단됨 — 다시 생성하시겠습니까?
          </p>
          {state.attemptsUsed ? (
            <p className="text-[11px] text-muted-foreground">
              시도 횟수: <span className="tabular-nums">{state.attemptsUsed}</span>
            </p>
          ) : null}
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => void generate(true)}
              aria-label="회고 재생성"
            >
              <RefreshCw className="h-3.5 w-3.5" aria-hidden /> 재생성
            </Button>
          </div>
        </CardContent>
      </Card>
    );
  }

  if (state.kind === 'error') {
    return (
      <Card>
        <CardHeader className="flex flex-row items-center gap-2">
          <AlertTriangle className="h-4 w-4 text-tilt-red" aria-hidden />
          <CardTitle>회고 생성 실패</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <p className="text-sm text-tilt-red">{state.message}</p>
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => void generate(false)}
              aria-label="회고 재시도"
            >
              <RefreshCw className="h-3.5 w-3.5" aria-hidden /> 다시 시도
            </Button>
          </div>
        </CardContent>
      </Card>
    );
  }

  // state.kind === 'success'
  return (
    <div className="flex flex-col gap-3">
      <RetrospectiveCard response={state.response} />
      <div className="flex justify-end">
        <Button
          variant="ghost"
          size="sm"
          onClick={() => void generate(true)}
          aria-label="회고 재생성 (다른 각도)"
        >
          <RefreshCw className="h-3.5 w-3.5" aria-hidden /> 재생성
        </Button>
      </div>
    </div>
  );
}
