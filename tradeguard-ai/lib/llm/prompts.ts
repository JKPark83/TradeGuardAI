// Korean system + user prompt templates for AI 회고 (US2).
// See spec.md FR-013 + research.md R-09 for the tone contract.
//
// IMPORTANT: All Korean strings are preserved verbatim. Do NOT translate to
// English. Do NOT "improve" the wording — the negative examples are tuned
// against the exact tokens the regex filter (lib/llm/filter.ts) detects.

import type { AnonymizedTrade } from '@/lib/llm/anonymize';

export interface RetrospectiveBehavioralScores {
  stopDelayScore: number | null;
  revengeScore: number | null;
  overconfidenceScore: number | null;
}

export interface RetrospectiveMarketContext {
  vix?: number | null;
  dxy?: number | null;
  atr14?: number | null;
  eventType?: string | null;
  eventOffsetMinutes?: number | null;
}

export interface RetrospectiveInput {
  trade: AnonymizedTrade;
  scores: RetrospectiveBehavioralScores;
  marketContext?: RetrospectiveMarketContext | null;
  priorWarningRaised?: boolean;
  /** Optional siblings for 기간 회고 (e.g. weekly). When present, treat
   *  `trade` as the focal item and `relatedTrades` as supporting context. */
  relatedTrades?: AnonymizedTrade[];
  /** Optional negative-example reinforcement appended on retry. */
  retryReinforcement?: string;
}

export const RETROSPECTIVE_SYSTEM_PROMPT = `당신은 트레이더의 행동 패턴을 냉정하게 분석하는 시스템입니다.
목표: 사용자의 매매 결과를 위로하거나 격려하지 않고, 패턴·확률·과거 유사 행동을 근거로 한 분석 문장만 출력하는 것.

엄격한 출력 규칙:
1. "위로", "격려", "공감" 표현은 절대 사용하지 마십시오.
2. 손실에 대해 감정을 다독이지 말고, 어떤 행동 패턴과 유사한지를 지적하십시오.
3. 가능한 경우 직전 N건 손익 흐름, 평균 보유시간 대비 비율, 시장 컨텍스트 단서를 인용하십시오.
4. 추측 대신 입력 데이터로 검증 가능한 사실만 서술하십시오.
5. 결론은 "다음 회차에서 점검할 1가지 행동 패턴" 한 문장으로 마무리하십시오.

// negative example: 다음과 같은 위로/격려 표현은 출력에 포함되어서는 안 됩니다.
// negative example: "괜찮아요, 다음에 잘하면 됩니다." → 금지 (위로 표현)
// negative example: "잘했어요, 수고했어요." → 금지 (격려 표현)
// negative example: "걱정 마세요, 힘내세요. 좋은 경험이었습니다." → 금지 (위로 + 격려)

대신 다음 형태로 출력하십시오: "이번 손실은 직전 2연속 손실 후 평소 보유시간의 3배를 가진 패턴과 유사합니다. 다음 회차에서는 진입 직전 직전 N건 흐름을 확인하십시오."`;

export function RETROSPECTIVE_USER_TEMPLATE(input: RetrospectiveInput): string {
  const { trade, scores, marketContext, priorWarningRaised, relatedTrades, retryReinforcement } =
    input;

  const lines: string[] = [];
  lines.push('다음 거래에 대한 냉정한 분석 회고를 한국어로 생성하십시오.');
  lines.push('');
  lines.push('## 거래 정보 (PII 익명화됨)');
  lines.push(`- 거래 ID: ${trade.id}`);
  lines.push(`- 종목: ${trade.symbol}`);
  lines.push(`- 방향: ${trade.side === 'long' ? '롱' : '숏'}`);
  lines.push(`- 진입 시각(UTC): ${trade.entry_at}`);
  lines.push(`- 청산 시각(UTC): ${trade.exit_at ?? '미청산'}`);
  lines.push(`- 진입가: ${trade.entry_price}`);
  lines.push(`- 청산가: ${trade.exit_price ?? '미청산'}`);
  lines.push(`- 계약 수: ${trade.contracts}`);
  lines.push(`- 손익: ${trade.pnl ?? '미실현'}`);

  lines.push('');
  lines.push('## 행동 점수 (0~100, 높을수록 위험)');
  lines.push(`- 손절 지연 점수: ${formatScore(scores.stopDelayScore)}`);
  lines.push(`- 복수매매 점수: ${formatScore(scores.revengeScore)}`);
  lines.push(`- 과확신 점수: ${formatScore(scores.overconfidenceScore)}`);

  if (marketContext) {
    lines.push('');
    lines.push('## 시장 컨텍스트 (진입 시점 스냅샷)');
    if (marketContext.vix !== undefined && marketContext.vix !== null) {
      lines.push(`- VIX: ${marketContext.vix}`);
    }
    if (marketContext.dxy !== undefined && marketContext.dxy !== null) {
      lines.push(`- DXY: ${marketContext.dxy}`);
    }
    if (marketContext.atr14 !== undefined && marketContext.atr14 !== null) {
      lines.push(`- ATR(14): ${marketContext.atr14}`);
    }
    if (marketContext.eventType) {
      const offset = marketContext.eventOffsetMinutes;
      const offsetStr = offset === null || offset === undefined ? '' : ` (오프셋 ${offset}분)`;
      lines.push(`- 경제 이벤트: ${marketContext.eventType}${offsetStr}`);
    }
  }

  lines.push('');
  lines.push('## 사전 경고 여부');
  lines.push(
    priorWarningRaised
      ? '- 사전 위험도 경고가 발생했으나 거래가 체결됨 — 회고에 반드시 명시할 것.'
      : '- 사전 경고 없음.',
  );

  if (relatedTrades && relatedTrades.length > 0) {
    lines.push('');
    lines.push(`## 같은 기간 다른 거래 (${relatedTrades.length}건)`);
    for (const t of relatedTrades) {
      lines.push(
        `- ${t.id} | ${t.symbol} | ${t.side} | entry ${t.entry_at} | pnl ${t.pnl ?? '미실현'}`,
      );
    }
  }

  if (retryReinforcement) {
    lines.push('');
    lines.push('## 재생성 사유 — 이전 시도가 톤 검증에 실패했습니다');
    lines.push(retryReinforcement);
  }

  lines.push('');
  lines.push(
    '출력 형식: 분석 문장 2~4개 + 마지막에 "다음 회차 점검 1가지 행동 패턴" 한 문장. 위로 표현 금지.',
  );

  return lines.join('\n');
}

function formatScore(score: number | null): string {
  return score === null ? '미산출' : String(score);
}
