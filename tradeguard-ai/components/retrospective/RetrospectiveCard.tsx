'use client';

/**
 * RetrospectiveCard — presentational card that renders a successful AI
 * retrospective response.
 *
 * No fetching here; consumers (RetrospectiveGenerator / PeriodRetrospectiveClient)
 * pass the validated `RetrospectiveResponse` body. We preserve paragraph breaks
 * with `whitespace-pre-wrap` because the LLM output is plain text — not
 * markdown — and the deterministic "냉정한 분석 톤" badge signals to the user
 * that consoling language has been filtered out (FR-009).
 */

import type { ReactNode } from 'react';
import { Sparkles } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import type { RetrospectiveResponse } from '@/types/api';

interface RetrospectiveCardProps {
  response: RetrospectiveResponse;
}

export function RetrospectiveCard({ response }: RetrospectiveCardProps): ReactNode {
  const { retrospectiveText, tokenUsage } = response;
  const totalTokens = tokenUsage.input + tokenUsage.output;

  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between gap-3">
        <div className="flex items-center gap-2">
          <Sparkles className="h-4 w-4 text-tilt-green" aria-hidden />
          <CardTitle>AI 분석 결과</CardTitle>
        </div>
        <span
          className="rounded-sm border border-border bg-background px-2 py-0.5 text-[10px] uppercase tracking-wider text-muted-foreground"
          aria-label="냉정한 분석 톤"
          title="위로 표현이 필터링된 냉정한 분석 톤"
        >
          냉정한 분석 톤
        </span>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <p className="whitespace-pre-wrap text-sm leading-relaxed text-foreground">
          {retrospectiveText}
        </p>
        <p className="text-[11px] text-muted-foreground">
          <span className="tabular-nums">{tokenUsage.model}</span>
          {' · '}
          <span className="tabular-nums">{totalTokens.toLocaleString()}</span> tokens
          <span className="ml-2 opacity-70">
            (input {tokenUsage.input.toLocaleString()} / output {tokenUsage.output.toLocaleString()}
            )
          </span>
        </p>
      </CardContent>
    </Card>
  );
}
