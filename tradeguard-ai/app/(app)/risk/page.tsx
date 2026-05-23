/**
 * `/risk` — 실시간 진입 위험도 평가 페이지 (서버 셸).
 *
 * 후보 거래(종목·방향·계약수)를 입력하면 5신호 결합 위험도를 산출한다.
 * 모든 상호작용 상태는 `<RiskAssessClient />` 안에서 관리한다.
 */

import type { ReactNode } from 'react';
import { RiskAssessClient } from './RiskAssessClient';

export const dynamic = 'force-dynamic';

export default function RiskPage(): ReactNode {
  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-1.5">
        <h1 className="text-xl font-semibold tracking-tight">실시간 진입 위험도 평가</h1>
        <p className="text-xs text-muted-foreground">
          후보 거래(종목·방향)를 입력하면 5신호 결합 위험도를 5초 이내에 산출합니다.
        </p>
      </header>
      <RiskAssessClient />
    </div>
  );
}
