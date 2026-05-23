/**
 * Finnhub economic calendar adapter (FR-009, R-05).
 *
 * The Finnhub free tier permits 60 req/min; we throttle to 1 rps with a small
 * burst (`finnhubLimiter`) to leave headroom for bursts at boot. The endpoint
 * returns *all* events in the window, so a single call covers many trades
 * unless they span more than ~2 weeks.
 *
 * Event-name normalization is intentionally narrow — we only collapse the
 * three macro categories we surface in the data model (`cpi` / `fomc` /
 * `nfp` / `cbproductivity`). Anything else falls through to `'normal'`,
 * matching the `EventType` enum in `types/db.ts`.
 *
 * Resilience: NEVER throw. Network failure / API error / missing API key →
 * return `[]` and log a warning. The backfill service treats `[]` as "no
 * scheduled event nearby" (event_type = 'normal').
 */

import { finnhubLimiter } from './cache';
import { logger } from '@/lib/utils/logger';
import type { EventType } from '@/types/db';

export interface EconomicEvent {
  type: EventType;
  scheduledAt: string;
  country: string;
  impact: string;
}

const FINNHUB_BASE = 'https://finnhub.io/api/v1';

interface FinnhubCalendarResponse {
  economicCalendar?: Array<{
    event?: string;
    country?: string;
    time?: string;
    impact?: string;
  }>;
}

/**
 * Map a raw Finnhub `event` string to our `EventType` enum.
 * Matching is case-insensitive substring — Finnhub is inconsistent
 * about capitalization ("CPI YoY" vs "Cpi MoM") and prefixes.
 */
export function classifyEventName(rawEvent: string | undefined): EventType {
  if (!rawEvent) return 'normal';
  const normalized = rawEvent.toLowerCase();
  if (normalized.includes('consumer price index') || normalized.includes('cpi')) return 'cpi';
  if (
    normalized.includes('fomc') ||
    normalized.includes('federal funds') ||
    normalized.includes('fed funds') ||
    normalized.includes('fed rate decision') ||
    normalized.includes('rate decision') ||
    normalized.includes('interest rate decision')
  ) {
    return 'fomc';
  }
  if (
    normalized.includes('non farm payroll') ||
    normalized.includes('non-farm payroll') ||
    normalized.includes('nonfarm payroll') ||
    normalized.includes('nfp')
  ) {
    return 'nfp';
  }
  if (normalized.includes('productivity')) return 'cbproductivity';
  return 'normal';
}

/**
 * Finnhub's `time` field is `YYYY-MM-DD HH:MM:SS` in UTC with no zone marker.
 * Parse it as UTC explicitly so `new Date(...)` does not pick up the local TZ.
 */
function parseFinnhubTime(raw: string | undefined): string | null {
  if (!raw) return null;
  const isoLike = raw.replace(' ', 'T');
  // Append Z only when there's no existing zone info.
  const hasZone = /[zZ]|[+-]\d{2}:?\d{2}$/.test(isoLike);
  const candidate = hasZone ? isoLike : `${isoLike}Z`;
  const d = new Date(candidate);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString();
}

function formatYmd(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/**
 * Fetch all economic events scheduled in [from, to]. Returns `[]` on any
 * failure (missing env, network, non-2xx, malformed JSON).
 */
export async function fetchEconomicCalendar(from: Date, to: Date): Promise<EconomicEvent[]> {
  const apiKey = process.env.FINNHUB_API_KEY;
  if (!apiKey) {
    logger.warn('finnhub_missing_api_key');
    // Still let MSW-mocked tests hit the endpoint — they don't validate the key.
    // In production a missing key is a real failure, but rather than throwing
    // we return [] (the adapter's contract). Tests pin FINNHUB_API_KEY in
    // setup if they need the request to actually issue.
  }

  await finnhubLimiter.acquire();

  const params = new URLSearchParams({
    from: formatYmd(from),
    to: formatYmd(to),
    token: apiKey ?? '',
  });
  const url = `${FINNHUB_BASE}/calendar/economic?${params.toString()}`;

  let payload: FinnhubCalendarResponse;
  try {
    const res = await fetch(url);
    if (!res.ok) {
      logger.warn('finnhub_calendar_http_error', { status: res.status });
      return [];
    }
    payload = (await res.json()) as FinnhubCalendarResponse;
  } catch (err) {
    logger.warn('finnhub_calendar_fetch_failed', {
      message: err instanceof Error ? err.message : String(err),
    });
    return [];
  }

  const rows = payload.economicCalendar ?? [];
  const events: EconomicEvent[] = [];
  for (const row of rows) {
    const scheduledAt = parseFinnhubTime(row.time);
    if (!scheduledAt) continue;
    events.push({
      type: classifyEventName(row.event),
      scheduledAt,
      country: row.country ?? 'UNKNOWN',
      impact: row.impact ?? 'low',
    });
  }
  return events;
}
