/**
 * Trading session + Tilt check pipeline integration test.
 *
 * Covers contracts/sessions-api.md:
 *   - POST /api/sessions → createSession returns row with ended_at=null
 *   - GET /api/sessions/active → findActiveSession returns the just-created row
 *   - POST /api/sessions/:id/tilt → second submission throws
 *     TiltAlreadySubmittedError (mapped to 409 by the route handler)
 *   - Submitting sleep=4, stress=8, externalEventSerious=true persists
 *     tilt_color='red' (R-07.4)
 *
 * Supabase is mocked end-to-end via `vi.fn()` — no real DB. The mock keeps
 * an in-memory store keyed by table so the repository functions can perform
 * real INSERT → SELECT round-trips.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';

import { createSession, endSession, findActiveSession } from '@/lib/repositories/sessions';
import {
  TiltAlreadySubmittedError,
  findTiltCheckBySession,
  insertTiltCheck,
} from '@/lib/repositories/tilt-checks';
import { computeTiltScore } from '@/lib/scoring/tilt';
import type { TiltCheck, TradingSession } from '@/types/db';

// ---- Supabase mock ----------------------------------------------------

const PG_UNIQUE_VIOLATION = '23505';

interface MockStores {
  trading_sessions: TradingSession[];
  tilt_checks: TiltCheck[];
}

type Row = Record<string, unknown>;
interface PgErrorLike {
  code: string;
  message: string;
}
type QueryResult = { data: Row | null; error: PgErrorLike | null };

function makeMockSupabase(): { client: SupabaseClient; stores: MockStores } {
  const stores: MockStores = { trading_sessions: [], tilt_checks: [] };
  let sessionSeq = 0;
  let tiltSeq = 0;

  const from = vi.fn((table: string) => {
    const filters: { col: string; op: 'eq' | 'is_null' | 'in'; val: unknown }[] = [];
    let pendingInsert: Row | null = null;
    let pendingUpdate: Row | null = null;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const builder: any = {};

    const matches = (row: Row): boolean =>
      filters.every((f) => {
        if (f.op === 'eq') return row[f.col] === f.val;
        if (f.op === 'is_null') return row[f.col] === null;
        return (f.val as unknown[]).includes(row[f.col]);
      });

    const tableRows = (): Row[] =>
      table === 'trading_sessions'
        ? (stores.trading_sessions as unknown as Row[])
        : (stores.tilt_checks as unknown as Row[]);

    const applyInsert = (): QueryResult => {
      if (!pendingInsert) return { data: null, error: null };
      if (table === 'trading_sessions') {
        sessionSeq += 1;
        const row: TradingSession = {
          id: `session-${sessionSeq}`,
          owner_id: (pendingInsert.owner_id as string) ?? 'user-1',
          started_at:
            (pendingInsert.started_at as string) ?? new Date('2026-05-23T13:30:00Z').toISOString(),
          ended_at: null,
          created_at: new Date('2026-05-23T13:30:00Z').toISOString(),
        };
        stores.trading_sessions.push(row);
        return { data: row as unknown as Row, error: null };
      }
      if (table === 'tilt_checks') {
        const sessionId = pendingInsert.session_id as string;
        if (stores.tilt_checks.some((t) => t.session_id === sessionId)) {
          return { data: null, error: { code: PG_UNIQUE_VIOLATION, message: 'duplicate' } };
        }
        tiltSeq += 1;
        const row: TiltCheck = {
          id: `tilt-${tiltSeq}`,
          session_id: sessionId,
          owner_id: pendingInsert.owner_id as string,
          sleep_score: pendingInsert.sleep_score as number,
          stress_score: pendingInsert.stress_score as number,
          external_event: (pendingInsert.external_event as string | null) ?? null,
          external_event_serious: pendingInsert.external_event_serious as boolean,
          tilt_color: pendingInsert.tilt_color as TiltCheck['tilt_color'],
          raw_score: pendingInsert.raw_score as string,
          submitted_at: new Date('2026-05-23T13:31:00Z').toISOString(),
        };
        stores.tilt_checks.push(row);
        return { data: row as unknown as Row, error: null };
      }
      return { data: null, error: null };
    };

    const applyUpdate = (): QueryResult => {
      if (!pendingUpdate) return { data: null, error: null };
      const row = tableRows().find(matches);
      if (!row) return { data: null, error: null };
      Object.assign(row, pendingUpdate);
      return { data: row, error: null };
    };

    builder.insert = vi.fn((p: Row) => {
      pendingInsert = p;
      return builder;
    });
    builder.update = vi.fn((p: Row) => {
      pendingUpdate = p;
      return builder;
    });
    builder.select = vi.fn(() => builder);
    builder.eq = vi.fn((col: string, val: unknown) => {
      filters.push({ col, op: 'eq', val });
      return builder;
    });
    builder.is = vi.fn((col: string, val: unknown) => {
      if (val === null) filters.push({ col, op: 'is_null', val: null });
      return builder;
    });
    builder.in = vi.fn((col: string, vals: unknown[]) => {
      filters.push({ col, op: 'in', val: vals });
      return builder;
    });
    builder.order = vi.fn(() => builder);
    builder.limit = vi.fn(() => builder);
    builder.single = vi.fn(async () => {
      if (pendingInsert) return applyInsert();
      if (pendingUpdate) return applyUpdate();
      return { data: tableRows().find(matches) ?? null, error: null };
    });
    builder.maybeSingle = vi.fn(async () => {
      if (pendingInsert) return applyInsert();
      if (pendingUpdate) return applyUpdate();
      return { data: tableRows().find(matches) ?? null, error: null };
    });

    return builder;
  });

  return { client: { from } as unknown as SupabaseClient, stores };
}

// ---- Tests ------------------------------------------------------------

describe('trading sessions pipeline', () => {
  let mock: ReturnType<typeof makeMockSupabase>;
  const ownerId = 'user-1';

  beforeEach(() => {
    mock = makeMockSupabase();
  });

  it('createSession returns a session with ended_at = null', async () => {
    const s = await createSession(mock.client, ownerId);
    expect(s.id).toBeDefined();
    expect(s.owner_id).toBe(ownerId);
    expect(s.ended_at).toBeNull();
    expect(mock.stores.trading_sessions).toHaveLength(1);
  });

  it('findActiveSession after createSession returns the same session', async () => {
    const created = await createSession(mock.client, ownerId);
    const active = await findActiveSession(mock.client, ownerId);
    expect(active?.id).toBe(created.id);
    expect(active?.ended_at).toBeNull();
  });

  it('endSession stamps ended_at and findActiveSession then returns null', async () => {
    const created = await createSession(mock.client, ownerId);
    const ended = await endSession(mock.client, ownerId, created.id);
    expect(ended.ended_at).not.toBeNull();
    expect(await findActiveSession(mock.client, ownerId)).toBeNull();
  });
});

describe('tilt check pipeline', () => {
  let mock: ReturnType<typeof makeMockSupabase>;
  const ownerId = 'user-1';

  beforeEach(() => {
    mock = makeMockSupabase();
  });

  it('insertTiltCheck twice on same session throws TiltAlreadySubmittedError', async () => {
    const session = await createSession(mock.client, ownerId);
    const { color, rawScore } = computeTiltScore({
      sleepScore: 5,
      stressScore: 5,
      externalEventSerious: false,
    });
    const payload = {
      sleepScore: 5,
      stressScore: 5,
      externalEvent: null,
      externalEventSerious: false,
      tiltColor: color,
      rawScore,
    };
    await insertTiltCheck(mock.client, ownerId, session.id, payload);
    await expect(insertTiltCheck(mock.client, ownerId, session.id, payload)).rejects.toBeInstanceOf(
      TiltAlreadySubmittedError,
    );
  });

  it('submit sleep=4, stress=8, externalEventSerious=true persists tilt_color="red"', async () => {
    const session = await createSession(mock.client, ownerId);
    // Hand-verify: raw = (10-4)*1.5 + 8*1.2 + 5 = 9 + 9.6 + 5 = 23.6 → red.
    const { color, rawScore } = computeTiltScore({
      sleepScore: 4,
      stressScore: 8,
      externalEventSerious: true,
    });
    expect(color).toBe('red');
    expect(rawScore).toBeCloseTo(23.6, 10);

    const inserted = await insertTiltCheck(mock.client, ownerId, session.id, {
      sleepScore: 4,
      stressScore: 8,
      externalEvent: '큰 손실 후 잠 못 잤음',
      externalEventSerious: true,
      tiltColor: color,
      rawScore,
    });

    expect(inserted.tilt_color).toBe('red');
    expect(inserted.session_id).toBe(session.id);
    expect(inserted.owner_id).toBe(ownerId);
    expect(inserted.sleep_score).toBe(4);
    expect(inserted.stress_score).toBe(8);
    expect(inserted.external_event_serious).toBe(true);

    const fetched = await findTiltCheckBySession(mock.client, session.id);
    expect(fetched?.id).toBe(inserted.id);
    expect(fetched?.tilt_color).toBe('red');
  });
});
