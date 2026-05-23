'use client';

/**
 * MarketBackfillButton — kicks off the async market-context backfill job (US3).
 *
 * Two-phase flow:
 *   1. POST /api/market-context/fill  → returns { jobId, queued, estimatedSeconds }
 *   2. Poll GET /api/market-context/fill/[jobId] every 2s until status !== 'running'
 *
 * On completion we:
 *   - invalidate the trades list + per-trade caches so the new snapshots show
 *   - surface a self-dismissing summary banner (filled / skipped / failed)
 *
 * We intentionally hold polling state in a `setInterval` ref instead of
 * react-query polling so the entire lifecycle (start, finish, error) sits
 * inside this one component — no external query key plumbing required.
 */

import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { CheckCircle2, RefreshCw, AlertTriangle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { apiFetch } from '@/lib/api/client';
import { cn } from '@/lib/utils/cn';

interface FillStartResponse {
  jobId: string;
  queued: number;
  estimatedSeconds: number;
}

interface FillStatusResponse {
  jobId: string;
  status: 'running' | 'completed' | 'failed';
  filled: number;
  skippedNoData: number;
  failed: number;
  total: number;
}

type BannerKind = 'success' | 'error';

interface Banner {
  kind: BannerKind;
  message: string;
}

const POLL_INTERVAL_MS = 2000;

export function MarketBackfillButton(): ReactNode {
  const qc = useQueryClient();
  const [jobId, setJobId] = useState<string | null>(null);
  const [progress, setProgress] = useState<FillStatusResponse | null>(null);
  const [banner, setBanner] = useState<Banner | null>(null);
  const [starting, setStarting] = useState(false);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const stopPolling = useCallback((): void => {
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
  }, []);

  useEffect(() => () => stopPolling(), [stopPolling]);

  const onFinish = useCallback(
    (status: FillStatusResponse): void => {
      stopPolling();
      setJobId(null);
      void qc.invalidateQueries({ queryKey: ['trades'] });
      void qc.invalidateQueries({ queryKey: ['trade'] });
      void qc.invalidateQueries({ queryKey: ['market', 'upcoming-events'] });

      if (status.status === 'completed') {
        setBanner({
          kind: 'success',
          message: `완료: ${status.filled}건 채움 · ${status.skippedNoData}건 데이터 없음 · ${status.failed}건 실패`,
        });
      } else {
        setBanner({
          kind: 'error',
          message: `실패: ${status.failed}/${status.total}건 처리 실패`,
        });
      }
    },
    [qc, stopPolling],
  );

  const pollOnce = useCallback(
    async (id: string): Promise<void> => {
      try {
        const res = await apiFetch<FillStatusResponse>(`/api/market-context/fill/${id}`);
        setProgress(res);
        if (res.status !== 'running') {
          onFinish(res);
        }
      } catch (err) {
        stopPolling();
        setJobId(null);
        const message = err instanceof Error ? err.message : '상태 조회 실패';
        setBanner({ kind: 'error', message });
      }
    },
    [onFinish, stopPolling],
  );

  const start = useCallback(async (): Promise<void> => {
    setStarting(true);
    setBanner(null);
    setProgress(null);
    try {
      const res = await apiFetch<FillStartResponse>('/api/market-context/fill', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ scope: 'missing_only' }),
      });
      if (res.queued === 0) {
        setBanner({ kind: 'success', message: '채울 거래가 없습니다 (이미 모두 컨텍스트 있음).' });
        return;
      }
      setJobId(res.jobId);
      setProgress({
        jobId: res.jobId,
        status: 'running',
        filled: 0,
        skippedNoData: 0,
        failed: 0,
        total: res.queued,
      });
      pollRef.current = setInterval(() => void pollOnce(res.jobId), POLL_INTERVAL_MS);
    } catch (err) {
      const message = err instanceof Error ? err.message : '백필 시작 실패';
      setBanner({ kind: 'error', message });
    } finally {
      setStarting(false);
    }
  }, [pollOnce]);

  const isRunning = jobId !== null;
  const percent =
    progress && progress.total > 0
      ? Math.min(
          100,
          Math.round(
            ((progress.filled + progress.skippedNoData + progress.failed) / progress.total) * 100,
          ),
        )
      : 0;

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-3">
        <Button
          variant="outline"
          size="sm"
          onClick={() => void start()}
          disabled={starting || isRunning}
          aria-label="시장 컨텍스트 채우기"
        >
          <RefreshCw className={cn('h-3.5 w-3.5', isRunning && 'animate-spin')} aria-hidden />
          {isRunning ? '채우는 중…' : '시장 컨텍스트 채우기'}
        </Button>
        {progress && isRunning ? (
          <span className="text-xs tabular-nums text-muted-foreground">
            {progress.filled + progress.skippedNoData + progress.failed} / {progress.total}
          </span>
        ) : null}
      </div>

      {progress && isRunning ? (
        <div
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={percent}
          className="h-1.5 w-full max-w-md overflow-hidden rounded-sm bg-muted"
        >
          <div
            className="h-full bg-tilt-green transition-[width]"
            style={{ width: `${percent}%` }}
          />
        </div>
      ) : null}

      {banner ? (
        <div
          role="status"
          aria-live="polite"
          className={cn(
            'flex items-center gap-2 rounded-md border px-3 py-2 text-xs',
            banner.kind === 'success'
              ? 'border-tilt-green/40 bg-tilt-green/10 text-tilt-green'
              : 'border-tilt-red/40 bg-tilt-red/10 text-tilt-red',
          )}
        >
          {banner.kind === 'success' ? (
            <CheckCircle2 className="h-3.5 w-3.5" aria-hidden />
          ) : (
            <AlertTriangle className="h-3.5 w-3.5" aria-hidden />
          )}
          <span>{banner.message}</span>
        </div>
      ) : null}
    </div>
  );
}
