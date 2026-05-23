/**
 * `/trades` — trades list page (server shell).
 *
 * Renders the heading then delegates to `<TradesPageClient />`, which uses
 * TanStack Query for fetch + cache. We avoid a server-side fetch here because
 * the same data is needed for filter-driven re-fetches; doing it all in the
 * client keeps the URL → query state → list flow in one place.
 */

import type { ReactNode } from 'react';
import { TradesPageClient } from './TradesPageClient';

export const dynamic = 'force-dynamic';

export default function TradesPage(): ReactNode {
  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-1.5">
        <h1 className="text-xl font-semibold tracking-tight">거래 목록</h1>
        <p className="text-xs text-muted-foreground">
          업로드된 거래 내역과 행동 분석 점수를 함께 확인할 수 있습니다.
        </p>
      </header>
      <TradesPageClient />
    </div>
  );
}
