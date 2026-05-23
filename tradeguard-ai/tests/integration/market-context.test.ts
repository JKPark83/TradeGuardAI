// @vitest-environment node

/**
 * Integration test for `lib/services/market-context.ts`.
 *
 * Why per-file `node` environment: the default `happy-dom` fetch polyfill
 * (vitest.config.ts) locks ReadableStream bodies when MSW intercepts HTTP
 * requests in this stack, surfacing as "Invalid state: ReadableStream is
 * locked" on every Yahoo/Finnhub call. Node's native `undici` fetch
 * (provided by the `node` env) interoperates with MSW correctly.
 *
 * Wiring strategy mirrors `tests/integration/retrospective.test.ts`:
 *   - Supabase is a hand-rolled chainable stub that captures upserts and
 *     answers trade-lookup queries.
 *   - Yahoo + Finnhub are NOT mocked here — MSW handlers in tests/mocks/
 *     handlers.ts already cover them at the HTTP layer (setup.ts enforces
 *     `onUnhandledRequest: 'error'`).
 *   - For the "Yahoo 404" case we override the chart handler per-test.
 *
 * Trade timestamps are pinned to the CPI / FOMC event windows the MSW fixture
 * exposes so we can assert `event_type` classification end-to-end.
 */

import { describe, expect, it, beforeEach } from 'vitest';
import { http, HttpResponse } from 'msw';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Trade, UUID } from '@/types/db';
import { backfillMarketContext } from '@/lib/services/market-context';
import { __resetYahooCaches } from '@/lib/market/yahoo';
import { server } from '@/tests/mocks/server';

const OWNER_ID = '00000000-0000-0000-0000-000000000a01';

// Pinned event timestamps from the MSW fixture (handlers.ts):
//   CPI YoY @ 2026-05-13 12:30:00Z
//   FOMC Rate Decision @ 2026-05-21 18:00:00Z

function buildTrade(id: UUID, overrides: Partial<Trade>): Trade {
  return {
    id,
    owner_id: OWNER_ID,
    session_id: null,
    symbol: 'NQ',
    side: 'long',
    entry_price: '20000',
    exit_price: '20100',
    entry_at: '2026-05-13T12:00:00Z',
    exit_at: '2026-05-13T13:00:00Z',
    pnl: '100',
    contracts: '1',
    source_csv_id: null,
    source_row: null,
    created_at: '2026-05-13T12:00:00Z',
    ...overrides,
  };
}

interface UpsertedSnapshot {
  trade_id: UUID;
  owner_id: UUID;
  symbol: string;
  vix: string | null;
  dxy: string | null;
  volume: string | null;
  atr_14: string | null;
  event_type: string | null;
  event_offset_minutes: number | null;
  data_source: string;
}

interface SupabaseStub {
  client: SupabaseClient;
  upserts: UpsertedSnapshot[];
}

/**
 * Build a Supabase stub that the backfill service can talk to:
 *   - `from('trades')` answers `.eq().in()` with the seeded trade rows
 *   - `from('market_snapshots').upsert(...)` captures payloads in `upserts`
 *   - `from('market_snapshots').select('trade_id').in('trade_id', [...])`
 *      returns [] so every requested id is treated as "missing".
 */
function buildSupabaseStub(trades: Trade[]): SupabaseStub {
  const upserts: UpsertedSnapshot[] = [];

  const tradesBuilder = () => {
    let filterIds: string[] | null = null;
    const builder = {
      select: () => builder,
      eq: () => builder,
      in: (_col: string, vals: string[]) => {
        filterIds = vals;
        return builder;
      },
      order: () => Promise.resolve({ data: trades, error: null }),
      then: (resolve: (v: { data: Pick<Trade, 'id'>[] | Trade[]; error: null }) => void) => {
        const rows = filterIds ? trades.filter((t) => filterIds!.includes(t.id)) : trades;
        resolve({ data: rows, error: null });
      },
    };
    return builder;
  };

  const snapshotsBuilder = () => {
    const builder = {
      select: () => builder,
      eq: () => builder,
      in: () => Promise.resolve({ data: [], error: null }),
      upsert: (row: UpsertedSnapshot) => {
        upserts.push(row);
        return Promise.resolve({ data: null, error: null });
      },
    };
    return builder;
  };

  const fromImpl = (table: string): unknown => {
    if (table === 'trades') return tradesBuilder();
    if (table === 'market_snapshots') return snapshotsBuilder();
    throw new Error(`unexpected table: ${table}`);
  };

  return {
    client: { from: fromImpl } as unknown as SupabaseClient,
    upserts,
  };
}

beforeEach(() => {
  __resetYahooCaches();
  process.env.FINNHUB_API_KEY = 'test-finnhub-key';
});

describe('backfillMarketContext', () => {
  it('writes snapshots for 3 trades, classifying CPI / FOMC / normal events', async () => {
    const trades: Trade[] = [
      // Within ±6h of CPI 2026-05-13 12:30Z
      buildTrade('00000000-0000-0000-0000-000000000b01', { entry_at: '2026-05-13T12:00:00Z' }),
      // Within ±6h of FOMC 2026-05-21 18:00Z
      buildTrade('00000000-0000-0000-0000-000000000b02', { entry_at: '2026-05-21T17:30:00Z' }),
      // Far from any event → 'normal'
      buildTrade('00000000-0000-0000-0000-000000000b03', { entry_at: '2026-06-15T14:00:00Z' }),
    ];
    const stub = buildSupabaseStub(trades);

    const result = await backfillMarketContext({
      supabase: stub.client,
      ownerId: OWNER_ID,
      scope: 'all',
    });

    expect(result.filled).toBe(3);
    expect(result.skippedNoData).toBe(0);
    expect(result.failed).toBe(0);
    expect(stub.upserts).toHaveLength(3);

    const byTrade = new Map(stub.upserts.map((s) => [s.trade_id, s]));
    expect(byTrade.get('00000000-0000-0000-0000-000000000b01')?.event_type).toBe('cpi');
    expect(byTrade.get('00000000-0000-0000-0000-000000000b02')?.event_type).toBe('fomc');
    expect(byTrade.get('00000000-0000-0000-0000-000000000b03')?.event_type).toBe('normal');

    // Yahoo fixture pins regularMarketPrice for ^VIX (17.5) and DXY (102.9).
    for (const snap of stub.upserts) {
      expect(snap.data_source).toBe('mixed');
      expect(snap.vix).not.toBeNull();
      expect(snap.dxy).not.toBeNull();
      expect(snap.owner_id).toBe(OWNER_ID);
    }
  });

  it('counts skippedNoData when Yahoo returns 404 for every chart symbol', async () => {
    const trades: Trade[] = [buildTrade('00000000-0000-0000-0000-000000000c01', { symbol: 'XYZ' })];
    const stub = buildSupabaseStub(trades);

    // Override Yahoo chart handler to 404 for this test only.
    server.use(
      http.get('https://query1.finance.yahoo.com/v8/finance/chart/:symbol', () => {
        return HttpResponse.json(
          { chart: { result: null, error: { code: 'Not Found' } } },
          {
            status: 404,
          },
        );
      }),
      // Also clear Finnhub for this trade window so the only signal is gone.
      http.get('https://finnhub.io/api/v1/calendar/economic', () => {
        return HttpResponse.json({ economicCalendar: [] });
      }),
    );

    const result = await backfillMarketContext({
      supabase: stub.client,
      ownerId: OWNER_ID,
      scope: 'all',
    });

    expect(result.filled).toBe(0);
    expect(result.skippedNoData).toBe(1);
    expect(result.failed).toBe(0);
    expect(stub.upserts).toHaveLength(0);
  });

  it('classifies event_type from the Finnhub fixture (CPI within window)', async () => {
    const trades: Trade[] = [
      buildTrade('00000000-0000-0000-0000-000000000d01', { entry_at: '2026-05-13T12:30:00Z' }),
    ];
    const stub = buildSupabaseStub(trades);

    const result = await backfillMarketContext({
      supabase: stub.client,
      ownerId: OWNER_ID,
      scope: 'all',
    });

    expect(result.filled).toBe(1);
    expect(stub.upserts[0].event_type).toBe('cpi');
    // The trade and the CPI release share the exact same minute → offset 0.
    expect(stub.upserts[0].event_offset_minutes).toBe(0);
  });
});
