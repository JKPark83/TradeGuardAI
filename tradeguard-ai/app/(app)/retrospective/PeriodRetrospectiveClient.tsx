'use client';

/**
 * PeriodRetrospectiveClient — date-range AI retrospective composer.
 *
 * Mirrors the single-trade flow in `RetrospectiveGenerator` but posts the
 * `{ periodFrom, periodTo }` request body shape. Validation is intentionally
 * minimal (server is authoritative); we only block submit when either date
 * is missing or `from > to`, since that always fails server-side.
 *
 * The dev-only raw-response collapsible exists because retrospective output
 * is non-deterministic — having the unredacted JSON handy during local QA
 * (token usage, inputSnapshot.anonymized) saves a network-tab round trip.
 */

import { useCallback, useState, type FormEvent, type ReactNode } from 'react';
import { AlertTriangle, RefreshCw, Sparkles } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input, Label } from '@/components/ui/form';
import { RetrospectiveCard } from '@/components/retrospective/RetrospectiveCard';
import { apiFetch, ApiClientError } from '@/lib/api/client';
import type { RetrospectiveResponse } from '@/types/api';

type ClientState =
  | { kind: 'idle' }
  | { kind: 'loading' }
  | { kind: 'success'; response: RetrospectiveResponse }
  | { kind: 'filtered_out'; attemptsUsed?: number }
  | { kind: 'error'; message: string };

function todayISO(): string {
  return new Date().toISOString().slice(0, 10);
}

function weekAgoISO(): string {
  const d = new Date();
  d.setDate(d.getDate() - 7);
  return d.toISOString().slice(0, 10);
}

export function PeriodRetrospectiveClient(): ReactNode {
  const [periodFrom, setPeriodFrom] = useState<string>(weekAgoISO());
  const [periodTo, setPeriodTo] = useState<string>(todayISO());
  const [state, setState] = useState<ClientState>({ kind: 'idle' });
  const [showDebug, setShowDebug] = useState(false);

  const isDev = process.env.NODE_ENV === 'development';
  const rangeInvalid = !periodFrom || !periodTo || periodFrom > periodTo;

  const submit = useCallback(async (): Promise<void> => {
    setState({ kind: 'loading' });
    try {
      const res = await apiFetch<RetrospectiveResponse>('/api/analysis/retrospective', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ periodFrom, periodTo }),
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
  }, [periodFrom, periodTo]);

  const onSubmit = (e: FormEvent<HTMLFormElement>): void => {
    e.preventDefault();
    if (rangeInvalid || state.kind === 'loading') return;
    void submit();
  };

  return (
    <div className="flex flex-col gap-4">
      <Card>
        <CardHeader>
          <CardTitle>기간 선택</CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={onSubmit} className="flex flex-col gap-4 sm:flex-row sm:items-end">
            <div className="flex flex-1 flex-col gap-1.5">
              <Label htmlFor="period-from">시작일</Label>
              <Input
                id="period-from"
                type="date"
                value={periodFrom}
                max={periodTo || undefined}
                onChange={(e) => setPeriodFrom(e.target.value)}
                required
              />
            </div>
            <div className="flex flex-1 flex-col gap-1.5">
              <Label htmlFor="period-to">종료일</Label>
              <Input
                id="period-to"
                type="date"
                value={periodTo}
                min={periodFrom || undefined}
                max={todayISO()}
                onChange={(e) => setPeriodTo(e.target.value)}
                required
              />
            </div>
            <Button
              type="submit"
              variant="default"
              size="md"
              disabled={rangeInvalid || state.kind === 'loading'}
              aria-label="기간 회고 생성"
            >
              <Sparkles className="h-3.5 w-3.5" aria-hidden />
              {state.kind === 'loading' ? 'AI 분석 중...' : '회고 생성'}
            </Button>
          </form>
          {rangeInvalid ? (
            <p className="mt-2 text-[11px] text-tilt-yellow">
              시작일은 종료일보다 빠르거나 같아야 합니다.
            </p>
          ) : null}
        </CardContent>
      </Card>

      {state.kind === 'loading' ? <LoadingSkeleton /> : null}

      {state.kind === 'filtered_out' ? (
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
            <div>
              <Button
                variant="outline"
                size="sm"
                onClick={() => void submit()}
                aria-label="기간 회고 재생성"
              >
                <RefreshCw className="h-3.5 w-3.5" aria-hidden /> 재생성
              </Button>
            </div>
          </CardContent>
        </Card>
      ) : null}

      {state.kind === 'error' ? (
        <Card>
          <CardHeader className="flex flex-row items-center gap-2">
            <AlertTriangle className="h-4 w-4 text-tilt-red" aria-hidden />
            <CardTitle>회고 생성 실패</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            <p className="text-sm text-tilt-red">{state.message}</p>
            <div>
              <Button
                variant="outline"
                size="sm"
                onClick={() => void submit()}
                aria-label="기간 회고 재시도"
              >
                <RefreshCw className="h-3.5 w-3.5" aria-hidden /> 다시 시도
              </Button>
            </div>
          </CardContent>
        </Card>
      ) : null}

      {state.kind === 'success' ? (
        <>
          <RetrospectiveCard response={state.response} />
          {isDev ? (
            <div className="rounded-md border border-border bg-background p-3 text-xs">
              <button
                type="button"
                onClick={() => setShowDebug((v) => !v)}
                className="text-muted-foreground hover:text-foreground"
                aria-expanded={showDebug}
              >
                {showDebug ? '▾' : '▸'} raw response (dev)
              </button>
              {showDebug ? (
                <pre className="mt-2 max-h-72 overflow-auto whitespace-pre-wrap break-words text-[11px] text-muted-foreground">
                  {JSON.stringify(state.response, null, 2)}
                </pre>
              ) : null}
            </div>
          ) : null}
        </>
      ) : null}
    </div>
  );
}

function LoadingSkeleton(): ReactNode {
  return (
    <Card>
      <CardHeader className="flex flex-row items-center gap-2">
        <Sparkles className="h-4 w-4 animate-pulse text-tilt-green" aria-hidden />
        <CardTitle>AI 분석 중...</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-2" aria-busy="true" aria-live="polite">
        <div className="h-3 w-3/4 animate-pulse rounded bg-muted/60" />
        <div className="h-3 w-full animate-pulse rounded bg-muted/60" />
        <div className="h-3 w-5/6 animate-pulse rounded bg-muted/60" />
        <div className="h-3 w-2/3 animate-pulse rounded bg-muted/60" />
        <p className="mt-2 text-[11px] text-muted-foreground">5~10초 소요</p>
      </CardContent>
    </Card>
  );
}
