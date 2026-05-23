/**
 * Prop firm profile + room-computation pipeline integration test.
 * Covers contracts/prop-firm-api.md — create profile, push trades, watch
 * the warning flip when daily-loss usage crosses warnThresholdPct.
 *
 * Supabase is mocked end-to-end with an in-memory store keyed by table.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';

import { createProfile } from '@/lib/repositories/prop-firm';
import { computeRoomForProfile } from '@/lib/services/prop-firm-room';
import type { PropFirmProfile, Trade } from '@/types/db';

// ---- Mock supabase ------------------------------------------------------

interface Stores {
  prop_firm_profiles: PropFirmProfile[];
  trades: Trade[];
  prop_firm_eod_balances: Array<{
    id: string;
    owner_id: string;
    profile_id: string;
    eod_date: string;
    eod_balance: string;
    daily_pnl: string;
    created_at: string;
  }>;
}

type Row = Record<string, unknown>;
interface PgErrorLike {
  code: string;
  message: string;
}
type QueryResult = { data: Row | Row[] | null; error: PgErrorLike | null };
interface Filter {
  col: string;
  op: 'eq' | 'is_null' | 'is_not_null' | 'gte' | 'lte' | 'gt' | 'lt';
  val: unknown;
}

function makeMockSupabase(): { client: SupabaseClient; stores: Stores } {
  const stores: Stores = { prop_firm_profiles: [], trades: [], prop_firm_eod_balances: [] };
  let profileSeq = 0;

  const tableRowsOf = (t: string): Row[] => {
    if (t === 'prop_firm_profiles') return stores.prop_firm_profiles as unknown as Row[];
    if (t === 'trades') return stores.trades as unknown as Row[];
    if (t === 'prop_firm_eod_balances') return stores.prop_firm_eod_balances as unknown as Row[];
    return [];
  };

  const matchesFn =
    (filters: Filter[]) =>
    (row: Row): boolean =>
      filters.every((f) => {
        const v = row[f.col];
        switch (f.op) {
          case 'eq':
            return v === f.val;
          case 'is_null':
            return v === null;
          case 'is_not_null':
            return v !== null;
          case 'gte':
            return String(v) >= String(f.val);
          case 'lte':
            return String(v) <= String(f.val);
          case 'gt':
            return String(v) > String(f.val);
          case 'lt':
            return String(v) < String(f.val);
        }
      });

  const from = vi.fn((table: string) => {
    const filters: Filter[] = [];
    let pendingInsert: Row | null = null;
    let pendingUpdate: Row | null = null;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const builder: any = {};

    const applyInsert = (): QueryResult => {
      if (!pendingInsert || table !== 'prop_firm_profiles') return { data: null, error: null };
      profileSeq += 1;
      const row: PropFirmProfile = {
        id: `profile-${profileSeq}`,
        owner_id: pendingInsert.owner_id as string,
        firm_name: pendingInsert.firm_name as PropFirmProfile['firm_name'],
        firm_label: (pendingInsert.firm_label as string | null) ?? null,
        account_size: pendingInsert.account_size as string,
        daily_loss_limit: (pendingInsert.daily_loss_limit as string | null) ?? null,
        drawdown_type: pendingInsert.drawdown_type as PropFirmProfile['drawdown_type'],
        drawdown_limit: pendingInsert.drawdown_limit as string,
        warn_threshold_pct: pendingInsert.warn_threshold_pct as string,
        is_active: (pendingInsert.is_active as boolean) ?? true,
        created_at: '2026-05-23T13:00:00Z',
      };
      stores.prop_firm_profiles.push(row);
      return { data: row as unknown as Row, error: null };
    };

    const matches = matchesFn(filters);
    const applyUpdate = (): QueryResult => {
      if (!pendingUpdate) return { data: null, error: null };
      const row = tableRowsOf(table).find(matches);
      if (!row) return { data: null, error: null };
      Object.assign(row, pendingUpdate);
      return { data: row, error: null };
    };
    const applySelect = (): QueryResult => ({
      data: tableRowsOf(table).filter(matches),
      error: null,
    });

    builder.insert = vi.fn((p: Row) => ((pendingInsert = p), builder));
    builder.update = vi.fn((p: Row) => ((pendingUpdate = p), builder));
    builder.select = vi.fn(() => builder);
    builder.eq = vi.fn(
      (c: string, v: unknown) => (filters.push({ col: c, op: 'eq', val: v }), builder),
    );
    builder.is = vi.fn((c: string, v: unknown) => {
      if (v === null) filters.push({ col: c, op: 'is_null', val: null });
      return builder;
    });
    builder.not = vi.fn((c: string, _op: string, v: unknown) => {
      if (v === null) filters.push({ col: c, op: 'is_not_null', val: null });
      return builder;
    });
    builder.gte = vi.fn(
      (c: string, v: unknown) => (filters.push({ col: c, op: 'gte', val: v }), builder),
    );
    builder.lte = vi.fn(
      (c: string, v: unknown) => (filters.push({ col: c, op: 'lte', val: v }), builder),
    );
    builder.in = vi.fn(() => builder);
    builder.order = vi.fn(() => builder);
    builder.limit = vi.fn(() => builder);
    builder.single = vi.fn(async () => {
      if (pendingInsert) return applyInsert();
      if (pendingUpdate) return applyUpdate();
      const arr = (applySelect().data as Row[]) ?? [];
      return { data: arr[0] ?? null, error: null };
    });
    builder.maybeSingle = vi.fn(async () => {
      const arr = (applySelect().data as Row[]) ?? [];
      return { data: arr[0] ?? null, error: null };
    });
    builder.then = (resolve: (r: QueryResult) => void) => resolve(applySelect());

    return builder;
  });

  return { client: { from } as unknown as SupabaseClient, stores };
}

function addTrade(stores: Stores, partial: Partial<Trade>): void {
  stores.trades.push({
    id: `trade-${stores.trades.length + 1}`,
    owner_id: 'user-1',
    session_id: null,
    symbol: 'ES',
    side: 'long',
    entry_price: '4500.00',
    exit_price: '4498.00',
    entry_at: '2026-05-23T13:00:00Z',
    exit_at: '2026-05-23T14:00:00Z',
    pnl: '-500.00',
    contracts: '1',
    source_csv_id: null,
    source_row: null,
    created_at: '2026-05-23T14:00:00Z',
    ...partial,
  });
}

// ---- Tests --------------------------------------------------------------

describe('prop-firm profile + room pipeline', () => {
  let mock: ReturnType<typeof makeMockSupabase>;
  const ownerId = 'user-1';
  // Pin "now" inside today (2026-05-23) so the UTC-day filter catches the
  // trade fixtures' exit_at values.
  const now = new Date('2026-05-23T18:00:00Z');

  beforeEach(() => {
    mock = makeMockSupabase();
  });

  it('createProfile persists with toFixed NUMERIC strings', async () => {
    const profile = await createProfile(mock.client, ownerId, {
      firmName: 'topstep',
      firmLabel: 'Topstep 50K',
      accountSize: 50000,
      dailyLossLimit: 1000,
      drawdownType: 'static',
      drawdownLimit: 2000,
      warnThresholdPct: 0.8,
    });
    expect(profile.id).toBeDefined();
    expect(profile.account_size).toBe('50000.00');
    expect(profile.drawdown_limit).toBe('2000.00');
    expect(profile.daily_loss_limit).toBe('1000.00');
    expect(profile.warn_threshold_pct).toBe('0.80');
    expect(profile.is_active).toBe(true);
  });

  it('500 loss → dailyLossUsedPct=0.5, warningActive=false', async () => {
    const profile = await createProfile(mock.client, ownerId, {
      firmName: 'topstep',
      accountSize: 50000,
      dailyLossLimit: 1000,
      drawdownType: 'static',
      drawdownLimit: 2000,
      warnThresholdPct: 0.8,
    });
    addTrade(mock.stores, { pnl: '-500.00', exit_at: '2026-05-23T14:00:00Z' });

    const room = await computeRoomForProfile(mock.client, ownerId, profile, now);
    expect(room.dailyLossRoom).toBe(500);
    expect(room.dailyLossUsedPct).toBeCloseTo(0.5, 10);
    expect(room.warningActive).toBe(false);
    // currentEquity = 50000 + (-500) = 49500; drawdownFloor = 48000; room = 1500
    expect(room.currentEquity).toBe(49500);
    expect(room.drawdownFloor).toBe(48000);
    expect(room.drawdownRoom).toBe(1500);
  });

  it('additional loss pushing daily loss to 800 → warningActive=true', async () => {
    const profile = await createProfile(mock.client, ownerId, {
      firmName: 'topstep',
      accountSize: 50000,
      dailyLossLimit: 1000,
      drawdownType: 'static',
      drawdownLimit: 2000,
      warnThresholdPct: 0.8,
    });
    addTrade(mock.stores, { pnl: '-500.00', exit_at: '2026-05-23T14:00:00Z' });
    addTrade(mock.stores, {
      pnl: '-300.00',
      exit_at: '2026-05-23T15:00:00Z',
    });

    const room = await computeRoomForProfile(mock.client, ownerId, profile, now);
    expect(room.dailyLossRoom).toBe(200);
    expect(room.dailyLossUsedPct).toBeCloseTo(0.8, 10);
    expect(room.warningActive).toBe(true);
    expect(room.currentEquity).toBe(49200);
  });

  it('winners do not reduce dailyLossRoom (loss-only semantics)', async () => {
    const profile = await createProfile(mock.client, ownerId, {
      firmName: 'topstep',
      accountSize: 50000,
      dailyLossLimit: 1000,
      drawdownType: 'static',
      drawdownLimit: 2000,
      warnThresholdPct: 0.8,
    });
    addTrade(mock.stores, { pnl: '-500.00', exit_at: '2026-05-23T14:00:00Z' });
    addTrade(mock.stores, { pnl: '+400.00', exit_at: '2026-05-23T15:00:00Z' });

    const room = await computeRoomForProfile(mock.client, ownerId, profile, now);
    // Today's REALIZED LOSS = 500 (winner not netted).
    expect(room.dailyLossRoom).toBe(500);
    // Cumulative PnL = -100 → currentEquity = 49900.
    expect(room.currentEquity).toBe(49900);
  });
});
