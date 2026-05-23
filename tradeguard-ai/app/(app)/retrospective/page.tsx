/**
 * `/retrospective` — 기간(주간) 회고 생성 페이지.
 *
 * Server shell: heading + 안내문만 렌더링하고, 실제 인터랙션(날짜 선택, POST,
 * 상태 머신)은 `<PeriodRetrospectiveClient />`에 위임. 단일 거래 회고는
 * `/analysis/[tradeId]` 페이지에서 `<RetrospectiveGenerator />`로 처리한다.
 */

import type { ReactNode } from 'react';
import { PeriodRetrospectiveClient } from './PeriodRetrospectiveClient';

export const dynamic = 'force-dynamic';

export default function RetrospectivePage(): ReactNode {
  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-1.5">
        <h1 className="text-xl font-semibold tracking-tight">주간/기간 회고</h1>
        <p className="text-xs text-muted-foreground">
          기간을 선택하면 해당 구간의 거래를 익명화하여 AI가 냉정한 톤의 회고를 생성합니다. 위로
          표현은 자동으로 필터링되며, 차단 시 재시도할 수 있습니다.
        </p>
      </header>
      <PeriodRetrospectiveClient />
    </div>
  );
}
