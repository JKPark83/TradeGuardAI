/**
 * Similar past trades panel.
 *
 * Renders the API-returned `SimilarPastTrade[]` as a clickable table. Each
 * row deep-links to `/analysis/[tradeId]` so the user can inspect the actual
 * historical trade that informed the similarity score — opacity here is a
 * UX requirement of the "냉정한 분석" tone.
 */

import Link from 'next/link';
import type { ReactNode } from 'react';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { cn } from '@/lib/utils/cn';
import type { SimilarPastTrade } from '@/types/api';

interface SimilarTradesPanelProps {
  trades: SimilarPastTrade[];
  candidateSymbol: string;
}

function formatEntryAt(iso: string): string {
  try {
    return new Date(iso).toLocaleString('ko-KR', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return iso;
  }
}

function formatPnl(pnl: number | null): { text: string; className: string } {
  if (pnl === null) return { text: '—', className: 'text-muted-foreground' };
  const sign = pnl > 0 ? '+' : '';
  const text = `${sign}${pnl.toLocaleString('en-US', { maximumFractionDigits: 2 })}`;
  if (pnl > 0) return { text, className: 'text-tilt-green tabular-nums' };
  if (pnl < 0) return { text, className: 'text-tilt-red tabular-nums' };
  return { text, className: 'text-muted-foreground tabular-nums' };
}

function similarityRiskScore(similarity: number, pnl: number | null): number {
  // Visual proxy: higher similarity to a losing trade = higher score.
  // The authoritative score is the assessment-level riskScore; this column
  // is a per-row indicator so the user can rank rows at a glance.
  const base = Math.round(similarity * 100);
  if (pnl !== null && pnl < 0) return Math.min(100, base);
  return Math.max(0, 100 - base);
}

function scoreClass(score: number): string {
  if (score >= 70) return 'text-tilt-red';
  if (score >= 40) return 'text-tilt-yellow';
  return 'text-tilt-green';
}

export function SimilarTradesPanel({
  trades,
  candidateSymbol,
}: SimilarTradesPanelProps): ReactNode {
  if (trades.length === 0) {
    return (
      <div className="rounded-md border border-border bg-muted/10 px-4 py-6 text-center text-sm text-muted-foreground">
        유사한 과거 거래 없음 — 데이터가 더 쌓이면 정확도 향상
      </div>
    );
  }

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>진입 시각</TableHead>
          <TableHead>종목</TableHead>
          <TableHead className="text-right">손익</TableHead>
          <TableHead className="text-right">유사도</TableHead>
          <TableHead className="text-right">위험도 점수</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {trades.map((t) => {
          const pnl = formatPnl(t.pnl);
          const score = similarityRiskScore(t.similarity, t.pnl);
          return (
            <TableRow key={t.tradeId} className="cursor-pointer">
              <TableCell colSpan={5} className="!p-0">
                <Link
                  href={`/analysis/${t.tradeId}`}
                  className="grid w-full grid-cols-[minmax(140px,1.4fr)_minmax(60px,0.6fr)_minmax(80px,0.8fr)_minmax(70px,0.7fr)_minmax(100px,0.9fr)] items-center gap-3 px-3 py-2 text-sm hover:bg-muted/40"
                  aria-label={`${formatEntryAt(t.entryAt)} 거래 상세 보기`}
                >
                  <span className="font-mono text-xs text-foreground">
                    {formatEntryAt(t.entryAt)}
                  </span>
                  <span className="text-foreground">{candidateSymbol}</span>
                  <span className={cn('text-right', pnl.className)}>{pnl.text}</span>
                  <span className="text-right font-mono tabular-nums text-foreground">
                    {Math.round(t.similarity * 100)}%
                  </span>
                  <span
                    className={cn(
                      'text-right font-mono font-semibold tabular-nums',
                      scoreClass(score),
                    )}
                  >
                    {score}
                  </span>
                </Link>
              </TableCell>
            </TableRow>
          );
        })}
      </TableBody>
    </Table>
  );
}
