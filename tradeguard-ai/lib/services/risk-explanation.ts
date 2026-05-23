// LLM-generated explanation for a risk assessment.
//
// One short Korean paragraph (≤ 200 chars) explaining the dominant signals
// and weight breakdown. The "cold analytical" tone constraint mirrors
// FR-013 / R-09 — `containsWarmthExpression` is the same filter used by the
// retrospective service.
//
// Failure policy (≤ 3s wall-clock budget per SC-004):
//   - The LLM call is wrapped in `Promise.race` with a 3000 ms timeout.
//   - On tone-filter rejection, retry ONCE with reinforcement.
//   - On second failure or timeout / network error → return the deterministic
//     fallback string (so the assessment still persists per FR-018).

import type { LlmClient } from '@/lib/llm/client';
import { containsWarmthExpression } from '@/lib/llm/filter';
import { logger } from '@/lib/utils/logger';
import type { RiskAssessmentSignals, RiskAssessmentWeights } from '@/types/db';

const LLM_TIMEOUT_MS = 3000;
const MAX_TOKENS = 320;

const SYSTEM_PROMPT = `냉정한 진입 위험도 분석. 5신호 비중과 점수 근거를 한국어 200자 이내로 설명. 위로 표현 금지.

엄격한 출력 규칙:
1. "위로", "격려", "공감" 표현은 절대 사용하지 마십시오 (예: "괜찮", "다음에 잘", "걱정 마", "힘내", "잘했", "수고했").
2. 각 신호의 가중 기여(예: "tilt 가중 0.20 × 신호 100 = 20")를 1~2개 언급하십시오.
3. 결론은 진입 시 점검할 1가지 패턴 한 문장으로 마무리하십시오.`;

const RETRY_REINFORCEMENT =
  '직전 응답에 위로 표현이 검출되었습니다. 사실·확률·가중치 기여만 출력하십시오.';

const FALLBACK_TEXT = 'AI 설명 생성 실패. 점수 근거는 신호 분해를 참고하세요.';

export interface RiskExplanationInput {
  riskScore: number;
  signals: RiskAssessmentSignals;
  effectiveWeights: RiskAssessmentWeights;
  warningMessage: string | null;
  floorApplied: boolean;
  /** Anonymized candidate descriptor (symbol/side/contracts). */
  candidate: { symbol: string; side: 'long' | 'short'; contracts: number | null };
}

function buildUserMessage(input: RiskExplanationInput, reinforce: boolean): string {
  const lines: string[] = [];
  lines.push('아래 후보 거래의 위험도 평가를 한국어 200자 이내로 분석하십시오.');
  lines.push('');
  lines.push('## 후보 (PII 익명화됨)');
  lines.push(`- 종목: ${input.candidate.symbol}`);
  lines.push(`- 방향: ${input.candidate.side === 'long' ? '롱' : '숏'}`);
  if (input.candidate.contracts !== null) {
    lines.push(`- 계약 수: ${input.candidate.contracts}`);
  }
  lines.push('');
  lines.push(
    `## 위험도 점수: ${input.riskScore}/100${input.floorApplied ? ' (Tilt-Red floor 적용)' : ''}`,
  );
  lines.push('');
  lines.push('## 5신호 (값, 가중)');
  lines.push(
    `- recentPnlStreak: ${input.signals.recentPnlStreak}, w=${input.effectiveWeights.recentPnlStreak.toFixed(3)}`,
  );
  lines.push(
    `- marketContext: ${input.signals.marketContext}, w=${input.effectiveWeights.marketContext.toFixed(3)}`,
  );
  lines.push(
    `- similarHistoryLossRate: ${input.signals.similarHistoryLossRate}, w=${input.effectiveWeights.similarHistoryLossRate.toFixed(3)}`,
  );
  lines.push(
    `- tilt: ${input.signals.tilt === null ? '미체크' : input.signals.tilt}, w=${input.effectiveWeights.tilt.toFixed(3)}`,
  );
  lines.push(
    `- propFirmRoom: ${input.signals.propFirmRoom === null ? '없음' : input.signals.propFirmRoom}, w=${input.effectiveWeights.propFirmRoom.toFixed(3)}`,
  );
  if (input.warningMessage) {
    lines.push('');
    lines.push(`## 시스템 경고: ${input.warningMessage}`);
  }
  if (reinforce) {
    lines.push('');
    lines.push(`## 재생성 사유: ${RETRY_REINFORCEMENT}`);
  }
  return lines.join('\n');
}

async function callWithTimeout(
  llmClient: Pick<LlmClient, 'messages'>,
  userMessage: string,
): Promise<string | null> {
  let timer: ReturnType<typeof setTimeout> | null = null;
  const timeout = new Promise<null>((resolve) => {
    timer = setTimeout(() => resolve(null), LLM_TIMEOUT_MS);
  });
  try {
    const call = llmClient
      .messages({ systemPrompt: SYSTEM_PROMPT, userMessage, maxTokens: MAX_TOKENS })
      .then((r) => r.text);
    const winner = await Promise.race([call, timeout]);
    return winner;
  } catch (err) {
    logger.warn('risk_explanation_llm_error', {
      message: err instanceof Error ? err.message : String(err),
    });
    return null;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/**
 * Generate the Korean LLM explanation, honoring tone filter + timeout.
 *
 * Returns the LLM text on success, or `FALLBACK_TEXT` on any failure
 * (timeout, network error, tone-filter-failed twice).
 */
export async function generateRiskExplanation(
  llmClient: Pick<LlmClient, 'messages'>,
  input: RiskExplanationInput,
): Promise<string> {
  // Attempt 1
  const first = await callWithTimeout(llmClient, buildUserMessage(input, false));
  if (first !== null && !containsWarmthExpression(first)) {
    return first;
  }
  if (first !== null) {
    logger.warn('risk_explanation_warmth_detected', { attempt: 1 });
  }

  // Attempt 2 with reinforcement
  const second = await callWithTimeout(llmClient, buildUserMessage(input, true));
  if (second !== null && !containsWarmthExpression(second)) {
    return second;
  }
  if (second !== null) {
    logger.warn('risk_explanation_warmth_detected', { attempt: 2 });
  }

  return FALLBACK_TEXT;
}

export const RISK_EXPLANATION_FALLBACK = FALLBACK_TEXT;
