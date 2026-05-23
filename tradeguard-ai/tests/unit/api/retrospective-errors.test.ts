// @vitest-environment node
//
// Unit tests for the retrospective error classifier.
// The classifier is the single seam keeping single-trade and period clients
// in sync — every new server-side error code must round-trip through this
// table so the UI knows whether to offer "재생성" vs "기간 다시 선택" etc.

import { describe, expect, it } from 'vitest';
import { ApiClientError } from '@/lib/api/client';
import { classifyRetrospectiveError } from '@/lib/api/retrospective-errors';

function err(status: number, body: Record<string, unknown>): ApiClientError {
  return new ApiClientError(status, body as Parameters<typeof ApiClientError>[1]);
}

describe('classifyRetrospectiveError', () => {
  it('maps tone_filter_failed → filtered_out with attemptsUsed', () => {
    const v = classifyRetrospectiveError(
      err(422, { error: 'tone_filter_failed', attemptsUsed: 3 }),
    );
    expect(v).toEqual({ kind: 'filtered_out', attemptsUsed: 3 });
  });

  it('maps no_trades_in_period → kind no_trades_in_period with friendly message + totalTrades', () => {
    const v = classifyRetrospectiveError(
      err(422, {
        error: 'no_trades_in_period',
        issues: [{ path: 'period', message: '선택한 기간에 거래가 없습니다.' }],
        totalTradesAllTime: 1314,
      }),
    );
    expect(v.kind).toBe('no_trades_in_period');
    if (v.kind !== 'no_trades_in_period') return;
    expect(v.message).toContain('거래가 없습니다');
    expect(v.totalTradesAllTime).toBe(1314);
  });

  it('maps invalid_period_range → kind invalid_period_range', () => {
    const v = classifyRetrospectiveError(err(400, { error: 'invalid_period_range' }));
    expect(v.kind).toBe('invalid_period_range');
    if (v.kind !== 'invalid_period_range') return;
    expect(v.message).toContain('시작일');
  });

  it('maps invalid_period_boundary → kind invalid_input', () => {
    const v = classifyRetrospectiveError(err(400, { error: 'invalid_period_boundary' }));
    expect(v.kind).toBe('invalid_input');
  });

  it('maps trade_not_found → kind trade_not_found', () => {
    const v = classifyRetrospectiveError(err(404, { error: 'trade_not_found' }));
    expect(v.kind).toBe('trade_not_found');
  });

  it('maps validation_failed → kind invalid_input with first issue message', () => {
    const v = classifyRetrospectiveError(
      err(400, {
        error: 'validation_failed',
        issues: [{ path: 'periodFrom', message: 'must be a valid ISO date or datetime string' }],
      }),
    );
    expect(v.kind).toBe('invalid_input');
    if (v.kind !== 'invalid_input') return;
    expect(v.message).toMatch(/ISO/);
  });

  it('maps unknown server error code → kind error with generic message', () => {
    const v = classifyRetrospectiveError(err(500, { error: 'unforeseen_thing' }));
    expect(v.kind).toBe('error');
  });

  it('falls back to error kind for non-ApiClientError throwables (network failure)', () => {
    const v = classifyRetrospectiveError(new TypeError('Failed to fetch'));
    expect(v.kind).toBe('error');
    if (v.kind !== 'error') return;
    expect(v.message).toContain('Failed to fetch');
  });
});
