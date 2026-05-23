/**
 * `/upload` — CSV upload page (server shell).
 *
 * The page itself is server-rendered only for heading/instruction copy; the
 * actual upload flow (drag-drop, FormData POST, mapping fallback dialog)
 * is handled by `<UploadClient />` so we can use browser APIs and TanStack
 * Query state without leaking client code into the route segment.
 */

import type { ReactNode } from 'react';
import { UploadClient } from './UploadClient';

export const dynamic = 'force-dynamic';

export default function UploadPage(): ReactNode {
  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-1.5">
        <h1 className="text-xl font-semibold tracking-tight">거래 업로드</h1>
        <p className="text-xs text-muted-foreground">
          표준 CSV 또는 브로커별 형식 지원. 첫 행은 헤더로 인식됩니다.
        </p>
      </header>
      <UploadClient />
    </div>
  );
}
