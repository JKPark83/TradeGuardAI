/**
 * MSW request handlers for unit + integration tests.
 *
 * Network access is forbidden in tests — `setupServer({ onUnhandledRequest:
 * 'error' })` causes any un-mocked request to fail loudly. Add a new handler
 * here when introducing a new external integration; do not loosen the policy.
 *
 * MSW v2 syntax: `http.method(url, resolver)` returning `HttpResponse.json(...)`.
 */

import { http, HttpResponse } from 'msw';

const RETROSPECTIVE_FIXTURE_TEXT =
  '이번 손실은 직전 2연속 손실 후 평소보다 3배 긴 보유시간을 가진 패턴과 유사합니다.';

const ANTHROPIC_MESSAGE_FIXTURE = {
  id: 'msg_test_01H',
  type: 'message',
  role: 'assistant',
  model: 'claude-sonnet-4-6',
  stop_reason: 'end_turn',
  stop_sequence: null,
  content: [
    {
      type: 'text' as const,
      text: RETROSPECTIVE_FIXTURE_TEXT,
    },
  ],
  usage: {
    input_tokens: 200,
    output_tokens: 80,
  },
};

const OPENAI_CHAT_FIXTURE = {
  id: 'chatcmpl-test01',
  object: 'chat.completion',
  created: 1717690000,
  model: 'gpt-4o-2024-08-06',
  choices: [
    {
      index: 0,
      message: {
        role: 'assistant',
        content: RETROSPECTIVE_FIXTURE_TEXT,
        refusal: null,
      },
      logprobs: null,
      finish_reason: 'stop',
    },
  ],
  usage: {
    prompt_tokens: 200,
    completion_tokens: 80,
    total_tokens: 280,
  },
  system_fingerprint: 'fp_test',
};

interface YahooQuote {
  symbol: string;
  closes: number[];
  base: number;
}

function buildYahooChart({ symbol, closes, base }: YahooQuote) {
  const now = Math.floor(Date.now() / 1000);
  const day = 24 * 60 * 60;
  const timestamps = closes.map((_, i) => now - (closes.length - 1 - i) * day);

  return {
    chart: {
      result: [
        {
          meta: {
            currency: 'USD',
            symbol,
            exchangeName: 'CME',
            instrumentType: 'FUTURE',
            regularMarketPrice: closes[closes.length - 1],
            previousClose: base,
            timezone: 'EST',
            exchangeTimezoneName: 'America/New_York',
          },
          timestamp: timestamps,
          indicators: {
            quote: [
              {
                open: closes.map((c) => c - 0.5),
                high: closes.map((c) => c + 1.0),
                low: closes.map((c) => c - 1.0),
                close: closes,
                volume: closes.map(() => 1_000_000),
              },
            ],
          },
        },
      ],
      error: null,
    },
  };
}

const SYMBOL_FIXTURES: Record<string, YahooQuote> = {
  '%5EVIX': { symbol: '^VIX', closes: [14.1, 14.8, 16.2, 18.0, 17.5], base: 13.9 },
  'DX-Y.NYB': { symbol: 'DXY', closes: [103.1, 103.4, 103.0, 102.8, 102.9], base: 103.0 },
  'NQ%3DF': { symbol: 'NQ=F', closes: [20000, 20100, 20050, 19950, 20020], base: 20000 },
  'ES%3DF': { symbol: 'ES=F', closes: [5800, 5810, 5790, 5780, 5795], base: 5800 },
};

export const handlers = [
  // Anthropic Messages API — pinned fixture so token counts are deterministic.
  http.post('https://api.anthropic.com/v1/messages', async () => {
    return HttpResponse.json(ANTHROPIC_MESSAGE_FIXTURE, { status: 200 });
  }),

  // OpenAI Chat Completions API — same fixture text so retrospective/risk
  // tests behave identically across LLM_PROVIDER=anthropic|openai.
  http.post('https://api.openai.com/v1/chat/completions', async () => {
    return HttpResponse.json(OPENAI_CHAT_FIXTURE, { status: 200 });
  }),

  // Yahoo Finance chart API — covers ^VIX, DXY, NQ, ES.
  http.get('https://query1.finance.yahoo.com/v8/finance/chart/:symbol', ({ params }) => {
    const raw = params.symbol;
    const symbol = typeof raw === 'string' ? raw : '';
    const fixture =
      SYMBOL_FIXTURES[symbol] ??
      ({
        symbol,
        closes: [100, 101, 102, 101, 100],
        base: 100,
      } satisfies YahooQuote);
    return HttpResponse.json(buildYahooChart(fixture));
  }),

  // Finnhub economic calendar — minimal CPI / FOMC events.
  http.get('https://finnhub.io/api/v1/calendar/economic', () => {
    return HttpResponse.json({
      economicCalendar: [
        {
          event: 'CPI YoY',
          country: 'US',
          time: '2026-05-13 12:30:00',
          impact: 'high',
          actual: null,
          estimate: 3.1,
          prev: 3.2,
          unit: '%',
        },
        {
          event: 'FOMC Rate Decision',
          country: 'US',
          time: '2026-05-21 18:00:00',
          impact: 'high',
          actual: null,
          estimate: 5.25,
          prev: 5.25,
          unit: '%',
        },
      ],
    });
  }),
];
