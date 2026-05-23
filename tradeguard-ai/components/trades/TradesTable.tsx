/**
 * Trades table — read-only summary list.
 *
 * Server- and client-renderable: no hooks or browser APIs. Clicking a row
 * navigates to `/analysis/[tradeId]` via Next's prefetching `<Link>` (used
 * in a wrapper component for non-form rows). We avoid attaching onClick to
 * `<tr>` for accessibility — a Link cell handles keyboard activation.
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
import type { TradeSummary } from '@/types/api';

interface TradesTableProps {
  trades: TradeSummary[];
}

function formatDateTime(iso: string | null): string {
  if (!iso) return '—';
  // YYYY-MM-DD HH:mm (UTC) — terminal aesthetic favors fixed-width parse-friendly output.
  return iso.replace('T', ' ').slice(0, 16);
}

function formatHoldingTime(entryAt: string, exitAt: string | null): string {
  if (!exitAt) return '미청산';
  const ms = new Date(exitAt).getTime() - new Date(entryAt).getTime();
  if (!Number.isFinite(ms) || ms < 0) return '—';
  const totalMin = Math.round(ms / 60_000);
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  return h > 0 ? `${h}시간 ${m}분` : `${m}분`;
}

function formatPnl(pnl: number | null): { text: string; cls: string } {
  if (pnl === null) return { text: '—', cls: 'text-muted-foreground' };
  const sign = pnl > 0 ? '+' : '';
  const cls = pnl > 0 ? 'text-tilt-green' : pnl < 0 ? 'text-tilt-red' : 'text-muted-foreground';
  return { text: `${sign}${pnl.toFixed(2)}`, cls };
}

export function TradesTable({ trades }: TradesTableProps): ReactNode {
  if (trades.length === 0) {
    return (
      <div className="rounded-md border border-dashed border-border bg-muted/10 p-6 text-center text-sm text-muted-foreground">
        조회된 거래가 없습니다.
      </div>
    );
  }

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>시각</TableHead>
          <TableHead>종목</TableHead>
          <TableHead>방향</TableHead>
          <TableHead className="text-right">진입가</TableHead>
          <TableHead className="text-right">청산가</TableHead>
          <TableHead className="text-right">손익</TableHead>
          <TableHead>보유시간</TableHead>
          <TableHead className="text-right">위험도</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {trades.map((t) => {
          const pnl = formatPnl(t.pnl);
          const risk = t.latestAnalysis?.riskScore ?? null;
          return (
            <TableRow key={t.id} className="cursor-pointer">
              <TableCell className="whitespace-nowrap">
                <Link href={`/analysis/${t.id}`} className="block w-full">
                  {formatDateTime(t.entryAt)}
                </Link>
              </TableCell>
              <TableCell>
                <Link href={`/analysis/${t.id}`} className="block w-full font-medium">
                  {t.symbol}
                </Link>
              </TableCell>
              <TableCell>
                <span
                  className={cn(
                    'inline-flex rounded px-1.5 py-0.5 text-xs',
                    t.side === 'long'
                      ? 'bg-tilt-green/15 text-tilt-green'
                      : 'bg-tilt-red/15 text-tilt-red',
                  )}
                >
                  {t.side === 'long' ? '매수' : '매도'}
                </span>
              </TableCell>
              <TableCell className="text-right tabular-nums">{t.entryPrice.toFixed(2)}</TableCell>
              <TableCell className="text-right tabular-nums">
                {t.exitPrice !== null ? t.exitPrice.toFixed(2) : '—'}
              </TableCell>
              <TableCell className={cn('text-right tabular-nums font-medium', pnl.cls)}>
                {pnl.text}
              </TableCell>
              <TableCell className="whitespace-nowrap text-muted-foreground">
                {formatHoldingTime(t.entryAt, t.exitAt)}
              </TableCell>
              <TableCell className="text-right tabular-nums">
                {risk !== null ? (
                  <span
                    className={cn(
                      risk >= 70
                        ? 'text-tilt-red'
                        : risk >= 40
                          ? 'text-tilt-yellow'
                          : 'text-tilt-green',
                    )}
                  >
                    {risk}
                  </span>
                ) : (
                  <span className="text-muted-foreground">—</span>
                )}
              </TableCell>
            </TableRow>
          );
        })}
      </TableBody>
    </Table>
  );
}
