'use client';

/**
 * Risk assessment client.
 *
 * Composition root for the /risk page:
 *   - Form (symbol / side / contracts / LLM toggle) → POST /api/risk/assess
 *   - Result panels (gauge, breakdown, similar trades, warning, LLM)
 *   - Recent assessments table (TanStack Query)
 *
 * Mutation result is held in component state (not in the query cache) so the
 * recent-list query stays the single source of truth for the table, while
 * the result panels reflect the *current* form submission only.
 */

import { useState, type FormEvent, type ReactNode } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input, Label } from '@/components/ui/form';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { RiskScoreGauge } from '@/components/risk/RiskScoreGauge';
import { RiskBreakdown } from '@/components/risk/RiskBreakdown';
import { SimilarTradesPanel } from '@/components/risk/SimilarTradesPanel';
import { WarningBanner } from '@/components/risk/WarningBanner';
import { LlmExplanationCard } from '@/components/risk/LlmExplanationCard';
import { apiFetch, ApiClientError } from '@/lib/api/client';
import { cn } from '@/lib/utils/cn';
import type { RiskAssessRequest, RiskAssessResponse } from '@/types/api';
import type { TradeSide } from '@/types/db';

interface RecentAssessment {
  assessmentId: string;
  requestedAt: string;
  candidateSymbol: string;
  candidateSide: TradeSide;
  riskScore: number;
  tiltColor: RiskAssessResponse['tiltColor'];
}

interface RecentAssessmentsResponse {
  assessments: RecentAssessment[];
}

function formatRequestedAt(iso: string): string {
  try {
    return new Date(iso).toLocaleString('ko-KR', {
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
  } catch {
    return iso;
  }
}

function scoreClass(score: number): string {
  if (score >= 70) return 'text-tilt-red';
  if (score >= 40) return 'text-tilt-yellow';
  return 'text-tilt-green';
}

export function RiskAssessClient(): ReactNode {
  const qc = useQueryClient();

  const [symbol, setSymbol] = useState<string>('NQ');
  const [side, setSide] = useState<TradeSide>('long');
  const [contracts, setContracts] = useState<string>('');
  const [includeLLM, setIncludeLLM] = useState<boolean>(true);
  const [result, setResult] = useState<RiskAssessResponse | null>(null);

  const assess = useMutation<RiskAssessResponse, Error, RiskAssessRequest>({
    mutationFn: (body) =>
      apiFetch<RiskAssessResponse>('/api/risk/assess', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      }),
    onSuccess: (data) => {
      setResult(data);
      void qc.invalidateQueries({ queryKey: ['risk', 'recent'] });
    },
  });

  const recent = useQuery<RecentAssessmentsResponse>({
    queryKey: ['risk', 'recent'],
    queryFn: () => apiFetch<RecentAssessmentsResponse>('/api/risk/assessments/recent?limit=20'),
  });

  function onSubmit(e: FormEvent<HTMLFormElement>): void {
    e.preventDefault();
    const trimmedSymbol = symbol.trim().toUpperCase();
    if (!trimmedSymbol) return;
    const body: RiskAssessRequest = {
      candidateSymbol: trimmedSymbol,
      candidateSide: side,
      includeLLMExplanation: includeLLM,
    };
    const parsed = contracts.trim() === '' ? null : Number(contracts);
    if (parsed !== null && Number.isFinite(parsed) && parsed > 0) {
      body.candidateContracts = parsed;
    }
    assess.mutate(body);
  }

  const errorMessage =
    assess.error instanceof ApiClientError
      ? (assess.error.body.error ?? '평가 요청에 실패했습니다.')
      : assess.error
        ? '평가 요청에 실패했습니다.'
        : null;

  return (
    <div className="flex flex-col gap-6">
      <Card>
        <CardHeader>
          <CardTitle>후보 거래 입력</CardTitle>
        </CardHeader>
        <CardContent>
          <form className="flex flex-col gap-4" onSubmit={onSubmit}>
            <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="symbol">종목</Label>
                <Input
                  id="symbol"
                  required
                  value={symbol}
                  onChange={(e) => setSymbol(e.target.value)}
                  placeholder="예: NQ, ES, CL"
                  autoComplete="off"
                  maxLength={16}
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label>방향</Label>
                <div role="radiogroup" aria-label="방향" className="flex h-9 gap-2">
                  {(['long', 'short'] as TradeSide[]).map((s) => (
                    <label
                      key={s}
                      className={cn(
                        'flex flex-1 cursor-pointer items-center justify-center gap-2 rounded-md border px-3 text-sm',
                        side === s
                          ? 'border-foreground/60 bg-muted/40 text-foreground'
                          : 'border-border bg-muted/10 text-muted-foreground hover:bg-muted/30',
                      )}
                    >
                      <input
                        type="radio"
                        name="side"
                        value={s}
                        checked={side === s}
                        onChange={() => setSide(s)}
                        className="sr-only"
                      />
                      {s === 'long' ? 'Long' : 'Short'}
                    </label>
                  ))}
                </div>
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="contracts">계약수 (선택)</Label>
                <Input
                  id="contracts"
                  type="number"
                  min={1}
                  step={1}
                  value={contracts}
                  onChange={(e) => setContracts(e.target.value)}
                  placeholder="예: 1"
                  inputMode="numeric"
                />
              </div>
            </div>

            <label className="flex items-center gap-2 text-sm text-muted-foreground">
              <input
                type="checkbox"
                checked={includeLLM}
                onChange={(e) => setIncludeLLM(e.target.checked)}
                className="h-4 w-4 rounded border-border"
              />
              <span>LLM 설명 포함 (PII 익명화 후 외부 모델 호출)</span>
            </label>

            <div className="flex items-center gap-3">
              <Button type="submit" disabled={assess.isPending} className="self-start">
                {assess.isPending ? '평가 중…' : '위험도 평가'}
              </Button>
              {errorMessage ? <span className="text-xs text-tilt-red">{errorMessage}</span> : null}
            </div>
          </form>
        </CardContent>
      </Card>

      {result ? (
        <div className="flex flex-col gap-4">
          <WarningBanner riskScore={result.riskScore} warningMessage={result.warningMessage} />

          <div className="grid grid-cols-1 gap-4 lg:grid-cols-[280px_1fr]">
            <Card>
              <CardContent className="flex items-center justify-center p-6">
                <RiskScoreGauge score={result.riskScore} tiltColor={result.tiltColor} />
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle>신호별 기여도</CardTitle>
              </CardHeader>
              <CardContent>
                <RiskBreakdown
                  signalsBreakdown={result.signalsBreakdown}
                  weights={result.weights}
                />
              </CardContent>
            </Card>
          </div>

          <Card>
            <CardHeader>
              <CardTitle>유사 과거 거래</CardTitle>
            </CardHeader>
            <CardContent>
              <SimilarTradesPanel
                trades={result.similarPastTrades}
                candidateSymbol={symbol.trim().toUpperCase()}
              />
            </CardContent>
          </Card>

          <LlmExplanationCard explanation={result.llmExplanation} />
        </div>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>최근 평가 이력</CardTitle>
        </CardHeader>
        <CardContent>
          {recent.isLoading ? (
            <p className="py-4 text-center text-sm text-muted-foreground">불러오는 중…</p>
          ) : recent.error ? (
            <p className="py-4 text-center text-sm text-tilt-red">이력을 불러오지 못했습니다.</p>
          ) : !recent.data || recent.data.assessments.length === 0 ? (
            <p className="py-4 text-center text-sm text-muted-foreground">
              평가 이력이 아직 없습니다.
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>요청 시각</TableHead>
                  <TableHead>종목</TableHead>
                  <TableHead>방향</TableHead>
                  <TableHead className="text-right">위험도</TableHead>
                  <TableHead>Tilt</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {recent.data.assessments.map((a) => (
                  <TableRow key={a.assessmentId}>
                    <TableCell className="font-mono text-xs">
                      {formatRequestedAt(a.requestedAt)}
                    </TableCell>
                    <TableCell>{a.candidateSymbol}</TableCell>
                    <TableCell className="uppercase">{a.candidateSide}</TableCell>
                    <TableCell
                      className={cn(
                        'text-right font-mono font-semibold tabular-nums',
                        scoreClass(a.riskScore),
                      )}
                    >
                      {a.riskScore}
                    </TableCell>
                    <TableCell className="text-xs uppercase tracking-wider text-muted-foreground">
                      {a.tiltColor}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
