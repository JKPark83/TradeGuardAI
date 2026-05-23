'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

import { Button } from '@/components/ui/button';
import { Input, Label } from '@/components/ui/form';

const CONFIRM_TOKEN = 'DELETE_ALL_MY_TRADEGUARD_DATA';

interface DeletionResponse {
  deleted: Record<string, number>;
  userSecretsRotated: boolean;
  completedAt: string;
}

export function AccountDeleteSection() {
  const router = useRouter();
  const [typedToken, setTypedToken] = useState('');
  const [confirming, setConfirming] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<DeletionResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  // 사용자가 정확한 토큰을 직접 타이핑해야 active. 복붙은 가능하지만
  // 그게 곧 명시적 확인의 의미이므로 OK.
  const tokenMatches = typedToken === CONFIRM_TOKEN;

  async function handleDelete(): Promise<void> {
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch('/api/account/data', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ confirm: CONFIRM_TOKEN }),
      });
      if (!res.ok) {
        const errorBody = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(errorBody.error ?? `HTTP ${res.status}`);
      }
      const body = (await res.json()) as DeletionResponse;
      setResult(body);
      // 5초 뒤 대시보드로 보내서 빈 상태 확인하게 함.
      setTimeout(() => router.push('/dashboard'), 5000);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'unknown_error');
    } finally {
      setSubmitting(false);
    }
  }

  if (result) {
    return (
      <div className="space-y-3 rounded-md border border-tilt-green/40 bg-tilt-green/5 p-4">
        <p className="font-semibold text-tilt-green">삭제 완료</p>
        <ul className="text-sm text-muted-foreground space-y-1">
          {Object.entries(result.deleted).map(([k, v]) => (
            <li key={k}>
              <span className="font-mono">{k}</span>: {v}개
            </li>
          ))}
          <li>secret 회전: {result.userSecretsRotated ? '✅' : '❌'}</li>
        </ul>
        <p className="text-xs text-muted-foreground">5초 후 대시보드로 이동합니다.</p>
      </div>
    );
  }

  if (!confirming) {
    return (
      <Button variant="destructive" onClick={() => setConfirming(true)}>
        모든 데이터 삭제 시작
      </Button>
    );
  }

  return (
    <div className="space-y-4">
      <div className="space-y-2 rounded-md border border-tilt-red/40 bg-tilt-red/5 p-4">
        <p className="font-semibold text-tilt-red">⚠️ 이 작업은 되돌릴 수 없습니다.</p>
        <p className="text-sm text-muted-foreground">
          모든 거래·분석·회고·Prop Firm 프로필·세션·Tilt 데이터가 즉시 영구 삭제됩니다. CSV 원본
          파일과 PII 익명화 시크릿도 함께 삭제·회전됩니다.
        </p>
      </div>

      <div className="space-y-2">
        <Label htmlFor="confirm-token">
          진행하려면 정확히 다음 문구를 타이핑하세요:{' '}
          <code className="px-1 py-0.5 rounded bg-muted font-mono text-xs">{CONFIRM_TOKEN}</code>
        </Label>
        <Input
          id="confirm-token"
          autoComplete="off"
          autoCapitalize="off"
          autoCorrect="off"
          spellCheck={false}
          value={typedToken}
          onChange={(e) => setTypedToken(e.target.value)}
          placeholder={CONFIRM_TOKEN}
          disabled={submitting}
        />
      </div>

      {error ? <p className="text-sm text-tilt-red">에러: {error}</p> : null}

      <div className="flex gap-2">
        <Button
          variant="destructive"
          onClick={handleDelete}
          disabled={!tokenMatches || submitting}
        >
          {submitting ? '삭제 중…' : '영구 삭제 실행'}
        </Button>
        <Button
          variant="outline"
          onClick={() => {
            setConfirming(false);
            setTypedToken('');
            setError(null);
          }}
          disabled={submitting}
        >
          취소
        </Button>
      </div>
    </div>
  );
}
