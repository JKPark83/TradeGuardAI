/**
 * Yahoo Finance adapter for the market-context backfill (FR-009, R-05).
 *
 * Why direct HTTP and not `yahoo-finance2`'s built-in helpers?
 * The installed `yahoo-finance2@2.14` only exposes `quote` + `autoc` modules —
 * `chart`/`historical` were removed. The MSW handler in `tests/mocks/handlers.ts`
 * intercepts the chart REST endpoint directly, which gives us full coverage
 * for both unit and integration paths with one wire format. If yahoo-finance2
 * re-introduces a `chart()` module later, swap `fetchYahooChart` to delegate
 * without changing this file's public surface.
 *
 * Contract (per task brief):
 *   fetchSnapshot(symbol, at) -> { vix, dxy, volume, atr14 } | null
 *   - VIX:    ticker `^VIX`            (Yahoo URL-encoded `%5EVIX`)
 *   - DXY:    ticker `DX-Y.NYB`
 *   - Volume: pulled from the user's primary symbol (NQ, ES, …)
 *   - ATR14:  computed from the previous 14 daily bars of the primary symbol
 *
 * Resilience rules:
 *   - NEVER throw. On network/API error, return null and log a warning.
 *   - Cache successful per-call results in a TtlCache keyed by (symbol, dayBucket)
 *     for 5 minutes — backfills hammering the same date should be cheap.
 *   - Rate limit via the shared `yahooLimiter` (5 rps, free-tier safe).
 */

import { yahooLimiter, TtlCache } from './cache';
import { logger } from '@/lib/utils/logger';

export interface YahooSnapshot {
  vix: number | null;
  dxy: number | null;
  volume: number | null;
  atr14: number | null;
}

interface YahooChartResponse {
  chart: {
    result: Array<{
      meta?: { regularMarketPrice?: number };
      timestamp?: number[];
      indicators?: {
        quote?: Array<{
          high?: Array<number | null>;
          low?: Array<number | null>;
          close?: Array<number | null>;
          volume?: Array<number | null>;
        }>;
      };
    }> | null;
    error: { code?: string; description?: string } | null;
  };
}

interface ChartBars {
  closes: number[];
  highs: number[];
  lows: number[];
  volumes: number[];
}

const FIVE_MINUTES_MS = 5 * 60 * 1000;
const ONE_DAY_MS = 24 * 60 * 60 * 1000;
const ATR_PERIOD = 14;
const YAHOO_BASE = 'https://query1.finance.yahoo.com/v8/finance/chart';

const snapshotCache = new TtlCache<string, YahooSnapshot>(FIVE_MINUTES_MS);
const chartCache = new TtlCache<string, ChartBars>(FIVE_MINUTES_MS);

function dayBucket(at: Date): string {
  return new Date(Math.floor(at.getTime() / ONE_DAY_MS) * ONE_DAY_MS).toISOString().slice(0, 10);
}

function snapshotCacheKey(symbol: string, at: Date): string {
  return `${symbol}|${dayBucket(at)}`;
}

async function fetchYahooChart(symbol: string, at: Date): Promise<ChartBars | null> {
  const cacheKey = `${symbol}|${dayBucket(at)}`;
  const hit = chartCache.get(cacheKey);
  if (hit) return hit;

  await yahooLimiter.acquire();

  // Window: ~25 trading days back from `at`, daily bars. Yahoo accepts unix
  // seconds; we widen the window by 35 calendar days to cover weekends/holidays
  // and still have ≥ 14 valid bars for ATR.
  const toSec = Math.floor(at.getTime() / 1000);
  const fromSec = Math.floor((at.getTime() - 35 * ONE_DAY_MS) / 1000);
  const url = `${YAHOO_BASE}/${encodeURIComponent(symbol)}?period1=${fromSec}&period2=${toSec}&interval=1d&events=history`;

  let payload: YahooChartResponse;
  try {
    const res = await fetch(url, { headers: { 'User-Agent': 'TradeGuard/1.0' } });
    if (!res.ok) {
      logger.warn('yahoo_chart_http_error', { symbol, status: res.status });
      return null;
    }
    payload = (await res.json()) as YahooChartResponse;
  } catch (err) {
    logger.warn('yahoo_chart_fetch_failed', {
      symbol,
      message: err instanceof Error ? err.message : String(err),
    });
    return null;
  }

  if (payload.chart.error) {
    logger.warn('yahoo_chart_api_error', {
      symbol,
      code: payload.chart.error.code,
      description: payload.chart.error.description,
    });
    return null;
  }

  const result = payload.chart.result?.[0];
  const quote = result?.indicators?.quote?.[0];
  if (!result || !quote) {
    logger.warn('yahoo_chart_empty', { symbol });
    return null;
  }

  const bars: ChartBars = {
    closes: (quote.close ?? []).filter((v): v is number => typeof v === 'number'),
    highs: (quote.high ?? []).filter((v): v is number => typeof v === 'number'),
    lows: (quote.low ?? []).filter((v): v is number => typeof v === 'number'),
    volumes: (quote.volume ?? []).filter((v): v is number => typeof v === 'number'),
  };
  chartCache.set(cacheKey, bars);
  return bars;
}

/**
 * Wilder's ATR(14): mean of True Range over the last `period` bars, where
 * TR = max(high - low, |high - prev_close|, |low - prev_close|).
 * Returns null if fewer than `period + 1` valid bars are available.
 */
function computeAtr14(bars: ChartBars): number | null {
  const { highs, lows, closes } = bars;
  const n = Math.min(highs.length, lows.length, closes.length);
  if (n < ATR_PERIOD + 1) return null;
  const start = n - ATR_PERIOD;
  const trs: number[] = [];
  for (let i = start; i < n; i += 1) {
    const prevClose = closes[i - 1];
    const tr = Math.max(
      highs[i] - lows[i],
      Math.abs(highs[i] - prevClose),
      Math.abs(lows[i] - prevClose),
    );
    trs.push(tr);
  }
  const sum = trs.reduce((acc, v) => acc + v, 0);
  return sum / ATR_PERIOD;
}

function lastClose(bars: ChartBars | null): number | null {
  if (!bars || bars.closes.length === 0) return null;
  return bars.closes[bars.closes.length - 1];
}

function lastVolume(bars: ChartBars | null): number | null {
  if (!bars || bars.volumes.length === 0) return null;
  return bars.volumes[bars.volumes.length - 1];
}

/**
 * Build a Yahoo snapshot for `(symbol, at)`. The primary symbol drives
 * volume + ATR14; VIX + DXY come from their own tickers in parallel.
 *
 * Returns `null` if *all three* upstream calls fail. Partial success is
 * surfaced — e.g. VIX missing but DXY present → the corresponding field
 * is `null` and the rest are populated. The caller is responsible for
 * deciding `data_source` based on which fields are non-null.
 */
export async function fetchSnapshot(symbol: string, at: Date): Promise<YahooSnapshot | null> {
  const cacheKey = snapshotCacheKey(symbol, at);
  const cached = snapshotCache.get(cacheKey);
  if (cached) return cached;

  // Parallelize the three chart pulls. The shared `yahooLimiter` enforces
  // rps fairness so this won't burst above the free-tier ceiling, and the
  // day-bucketed `chartCache` collapses repeat ^VIX / DXY pulls across
  // every trade in the same backfill.
  const [primary, vixBars, dxyBars] = await Promise.all([
    fetchYahooChart(symbol, at),
    fetchYahooChart('^VIX', at),
    fetchYahooChart('DX-Y.NYB', at),
  ]);

  const allFailed = primary === null && vixBars === null && dxyBars === null;
  if (allFailed) {
    logger.warn('yahoo_snapshot_all_sources_failed', { symbol });
    return null;
  }

  const snapshot: YahooSnapshot = {
    vix: lastClose(vixBars),
    dxy: lastClose(dxyBars),
    volume: lastVolume(primary),
    atr14: primary ? computeAtr14(primary) : null,
  };
  snapshotCache.set(cacheKey, snapshot);
  return snapshot;
}

/** Exposed for tests. Resets both the snapshot and chart caches. */
export function __resetYahooCaches(): void {
  snapshotCache.clear();
  chartCache.clear();
}
