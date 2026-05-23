/**
 * Unit tests for lib/llm/filter.ts.
 *
 * Each BLACKLIST regex gets a positive case (must match) + a structural
 * negative case (similar-but-safe text must NOT match), plus the spec-
 * documented sentence-level fixtures from contracts/analysis-api.md and
 * research.md#R-09.
 */

import { describe, expect, it } from 'vitest';
import { BLACKLIST, containsWarmthExpression } from '@/lib/llm/filter';

describe('BLACKLIST coverage', () => {
  const cases: { name: string; positive: string; negative: string }[] = [
    { name: '괜찮', positive: '괜찮아요, 진정하세요.', negative: '관찰 결과는 다음과 같습니다.' },
    {
      name: '다음에 잘',
      positive: '다음에 잘하면 됩니다.',
      negative: '다음 회차의 진입 전략을 점검하십시오.',
    },
    { name: '잘했', positive: '오늘 잘했어요.', negative: '잘못된 진입 시점이 확인됩니다.' },
    { name: '수고했', positive: '오늘도 수고했어요.', negative: '수고로운 분석이 필요합니다.' },
    {
      name: '걱정 마',
      positive: '걱정 마세요, 회복 가능합니다.',
      negative: '걱정스러운 패턴이 보입니다.',
    },
    { name: '힘내', positive: '힘내세요!', negative: '힘있는 모멘텀 신호는 없습니다.' },
    { name: '화이팅', positive: '내일도 화이팅입니다.', negative: '화이트보드에 기록된 전략.' },
    { name: '파이팅', positive: '파이팅 하십시오.', negative: '파이프라인 구성을 점검하십시오.' },
    {
      name: '좋은 경험',
      positive: '이번 손실은 좋은 경험이었습니다.',
      negative: '좋은 진입 시점을 식별할 수 있습니다.',
    },
  ];

  for (const c of cases) {
    it(`matches positive case for ${c.name}`, () => {
      expect(containsWarmthExpression(c.positive)).toBe(true);
    });
    it(`rejects negative case for ${c.name}`, () => {
      expect(containsWarmthExpression(c.negative)).toBe(false);
    });
  }

  it('exports the regex list for testability', () => {
    expect(BLACKLIST.length).toBeGreaterThanOrEqual(9);
    for (const r of BLACKLIST) {
      expect(r).toBeInstanceOf(RegExp);
    }
  });
});

describe('spec-documented fixtures', () => {
  it('returns false for analytical sentence', () => {
    const sentence = '이번 손실은 직전 2연속 손실 패턴과 유사합니다';
    expect(containsWarmthExpression(sentence)).toBe(false);
  });

  it('returns true for warmth-laden sentence', () => {
    const sentence = '괜찮아요, 다음에 잘하면 됩니다';
    expect(containsWarmthExpression(sentence)).toBe(true);
  });

  it('returns true for "잘했어요"', () => {
    expect(containsWarmthExpression('잘했어요')).toBe(true);
  });

  it('returns false for risk score statement', () => {
    expect(containsWarmthExpression('패턴 분석 결과 위험도 70')).toBe(false);
  });

  it('returns false for empty input', () => {
    expect(containsWarmthExpression('')).toBe(false);
  });

  it('returns true even when warmth phrase appears mid-paragraph', () => {
    const text = '패턴 분석 결과 위험도 70. 하지만 괜찮습니다, 다음 거래에서 보완하면 됩니다.';
    expect(containsWarmthExpression(text)).toBe(true);
  });

  it('handles whitespace variants for "다음에 잘"', () => {
    expect(containsWarmthExpression('다음에잘')).toBe(true);
    expect(containsWarmthExpression('다음에   잘')).toBe(true);
  });

  it('handles whitespace variants for "걱정 마"', () => {
    expect(containsWarmthExpression('걱정마')).toBe(true);
    expect(containsWarmthExpression('걱정  마세요')).toBe(true);
  });
});
