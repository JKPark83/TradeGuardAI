/**
 * `/prop-firm` — Prop Firm compliance surface (US5).
 *
 * Thin server shell that mounts the client page. All data fetching happens on
 * the client via TanStack Query so that mutations (create/update/deactivate)
 * can invalidate the same cache key without re-rendering the whole route.
 */

import type { ReactNode } from 'react';
import { PropFirmPage } from './PropFirmPage';

export const dynamic = 'force-dynamic';

export default function PropFirmRoute(): ReactNode {
  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-1.5">
        <h1 className="text-xl font-semibold tracking-tight">Prop Firm 컴플라이언스</h1>
        <p className="text-xs text-muted-foreground">
          펀딩 계정 룰셋을 등록하고 일일 손실·드로우다운 여유를 실시간으로 추적합니다.
        </p>
      </header>
      <PropFirmPage />
    </div>
  );
}
