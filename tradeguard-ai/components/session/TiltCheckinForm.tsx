'use client';

/**
 * Mental check-in form for a fresh trading session.
 *
 * Fields:
 *   - sleepScore 1-10 (range slider with numeric display)
 *   - stressScore 1-10 (range slider with numeric display)
 *   - externalEvent (free text, optional)
 *   - externalEventSerious (checkbox, controls a multiplier in tilt scoring)
 *
 * On success, the parent's `['session','active']` query is invalidated so
 * the panel re-renders into the "active + tilt" state inline (no redirect).
 */

import { useState, type FormEvent, type ReactNode } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { Label, Textarea } from '@/components/ui/form';
import { apiFetch, ApiClientError } from '@/lib/api/client';
import { cn } from '@/lib/utils/cn';
import type { TiltSubmitRequest, TiltSubmitResponse } from '@/types/api';
import type { TiltColor } from '@/types/db';

interface TiltCheckinFormProps {
  sessionId: string;
}

const COLOR_TEXT: Record<TiltColor, string> = {
  green: 'text-tilt-green',
  yellow: 'text-tilt-yellow',
  red: 'text-tilt-red',
};

const COLOR_LABEL: Record<TiltColor, string> = {
  green: 'GREEN (안정)',
  yellow: 'YELLOW (주의)',
  red: 'RED (경고)',
};

export function TiltCheckinForm({ sessionId }: TiltCheckinFormProps): ReactNode {
  const qc = useQueryClient();
  const [sleepScore, setSleepScore] = useState(7);
  const [stressScore, setStressScore] = useState(4);
  const [externalEvent, setExternalEvent] = useState('');
  const [externalEventSerious, setExternalEventSerious] = useState(false);
  const [result, setResult] = useState<TiltSubmitResponse | null>(null);

  const mutation = useMutation<TiltSubmitResponse, Error, TiltSubmitRequest>({
    mutationFn: (body) =>
      apiFetch<TiltSubmitResponse>(`/api/sessions/${sessionId}/tilt`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      }),
    onSuccess: (data) => {
      setResult(data);
      void qc.invalidateQueries({ queryKey: ['session', 'active'] });
    },
  });

  function onSubmit(e: FormEvent<HTMLFormElement>): void {
    e.preventDefault();
    const payload: TiltSubmitRequest = {
      sleepScore,
      stressScore,
      externalEvent: externalEvent.trim().length > 0 ? externalEvent.trim() : null,
      externalEventSerious,
    };
    mutation.mutate(payload);
  }

  if (result) {
    return (
      <div className="flex flex-col gap-3">
        <p className="text-sm">
          체크인 완료 — Tilt:{' '}
          <span className={cn('font-semibold', COLOR_TEXT[result.tiltColor])}>
            {COLOR_LABEL[result.tiltColor]}
          </span>
        </p>
        <div className="flex flex-col gap-1">
          <span className="text-xs uppercase tracking-wider text-muted-foreground">권장 사항</span>
          <ul className="list-disc pl-5 text-sm">
            {result.recommendations.map((r) => (
              <li key={r}>{r}</li>
            ))}
          </ul>
        </div>
      </div>
    );
  }

  const errorMessage = mutation.error
    ? mutation.error instanceof ApiClientError
      ? mutation.error.body.error === 'tilt_already_submitted'
        ? '이미 체크인이 등록된 세션입니다.'
        : '체크인 저장에 실패했습니다.'
      : '체크인 저장에 실패했습니다.'
    : null;

  return (
    <form className="flex flex-col gap-4" onSubmit={onSubmit}>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="sleep-score">수면 점수 ({sleepScore} / 10)</Label>
        <input
          id="sleep-score"
          type="range"
          min={1}
          max={10}
          step={1}
          value={sleepScore}
          onChange={(e) => setSleepScore(Number(e.target.value))}
          className="w-full accent-tilt-green"
        />
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="stress-score">스트레스 점수 ({stressScore} / 10)</Label>
        <input
          id="stress-score"
          type="range"
          min={1}
          max={10}
          step={1}
          value={stressScore}
          onChange={(e) => setStressScore(Number(e.target.value))}
          className="w-full accent-tilt-red"
        />
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="external-event">직전 외부 사건 (선택)</Label>
        <Textarea
          id="external-event"
          placeholder="예: 어제 큰 손실 후 잠을 거의 못 잠"
          value={externalEvent}
          onChange={(e) => setExternalEvent(e.target.value)}
          rows={3}
          maxLength={500}
        />
      </div>

      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={externalEventSerious}
          onChange={(e) => setExternalEventSerious(e.target.checked)}
          className="h-4 w-4 accent-tilt-red"
        />
        <span>심각한 사건이었음 (Tilt 가중치 증가)</span>
      </label>

      {errorMessage ? <p className="text-xs text-tilt-red">{errorMessage}</p> : null}

      <Button type="submit" disabled={mutation.isPending} className="self-start">
        {mutation.isPending ? '저장 중…' : '체크인 완료'}
      </Button>
    </form>
  );
}
