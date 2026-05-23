// Shared classifier for `/api/analysis/retrospective` error responses.
//
// The route can fail in several distinct ways and the UI must show *different*
// messaging for each — historically the clients lumped every non-2xx into
// "tone-filter failed", which mis-led users when the actual cause was "no
// trades in this period". Centralizing the branching here means single-trade
// and period clients stay in sync as we add new server-side error codes.

import { ApiClientError } from './client';

export type RetrospectiveClientErrorKind =
  /** Server applied the warmth-tone filter 3 times and gave up. Surfaceable as "재생성". */
  | { kind: 'filtered_out'; attemptsUsed?: number }
  /** User asked for a period containing 0 trades. Action: change period or upload more CSV. */
  | { kind: 'no_trades_in_period'; message: string; totalTradesAllTime?: number }
  /** periodFrom > periodTo. Action: fix the range. */
  | { kind: 'invalid_period_range'; message: string }
  /** Date string we couldn't parse, or other 400-class issues. */
  | { kind: 'invalid_input'; message: string }
  /** Caller passed a tradeId that doesn't exist (404). Action: refresh trades list. */
  | { kind: 'trade_not_found'; message: string }
  /** Catch-all — network failure, 5xx, etc. */
  | { kind: 'error'; message: string };

const HUMAN_MESSAGE: Record<string, string> = {
  no_trades_in_period: '선택한 기간에 거래가 없습니다. 기간을 다시 확인하거나 CSV를 업로드해 주세요.',
  invalid_period_range: '시작일이 종료일보다 늦습니다. 기간을 다시 선택해 주세요.',
  invalid_period_boundary: '날짜 형식을 인식하지 못했습니다. YYYY-MM-DD 형식으로 입력해 주세요.',
  trade_not_found: '거래를 찾을 수 없습니다. 목록을 새로고침해 주세요.',
  validation_failed: '입력 값을 확인해 주세요.',
  unauthenticated: '로그인이 필요합니다.',
  rate_limited: '회고 호출 빈도를 초과했습니다. 잠시 후 다시 시도해 주세요.',
};

function firstIssueMessage(body: Record<string, unknown>): string | undefined {
  const issues = body.issues;
  if (Array.isArray(issues) && issues.length > 0) {
    const first = issues[0];
    if (first && typeof first === 'object' && 'message' in first) {
      const m = (first as { message?: unknown }).message;
      if (typeof m === 'string' && m.length > 0) return m;
    }
  }
  return undefined;
}

/**
 * Map a thrown value from `apiFetch('/api/analysis/retrospective', ...)` to a
 * tagged client state. Never throws; non-ApiClientError inputs become 'error'.
 */
export function classifyRetrospectiveError(err: unknown): RetrospectiveClientErrorKind {
  if (!(err instanceof ApiClientError)) {
    const message = err instanceof Error ? err.message : '회고 생성 중 오류가 발생했습니다.';
    return { kind: 'error', message };
  }

  const code = err.body.error;
  const issueMsg = firstIssueMessage(err.body as unknown as Record<string, unknown>);
  const friendly = (HUMAN_MESSAGE[code] ?? '회고 생성 중 오류가 발생했습니다.');

  switch (code) {
    case 'tone_filter_failed': {
      const attempts = (err.body as Record<string, unknown>)['attemptsUsed'];
      return {
        kind: 'filtered_out',
        attemptsUsed: typeof attempts === 'number' ? attempts : undefined,
      };
    }
    case 'no_trades_in_period': {
      const total = (err.body as Record<string, unknown>)['totalTradesAllTime'];
      return {
        kind: 'no_trades_in_period',
        message: issueMsg ?? friendly,
        totalTradesAllTime: typeof total === 'number' ? total : undefined,
      };
    }
    case 'invalid_period_range':
      return { kind: 'invalid_period_range', message: issueMsg ?? friendly };
    case 'invalid_period_boundary':
    case 'validation_failed':
      return { kind: 'invalid_input', message: issueMsg ?? friendly };
    case 'trade_not_found':
      return { kind: 'trade_not_found', message: issueMsg ?? friendly };
    default:
      return { kind: 'error', message: friendly };
  }
}
