/**
 * CSV upload → DB pipeline integration test.
 *
 * Covers contracts/trades-api.md `POST /api/trades/upload`:
 *   - Returns CsvUploadResponse with accepted/rejected counts
 *   - Inserts accepted rows into `trades` with the correct shape
 *   - Duplicate rows on a re-upload are surfaced (not double-inserted)
 *
 * Supabase is mocked end-to-end via `vi.fn()` — no real DB.
 */

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it, expect, beforeEach, vi } from 'vitest';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

import { handleCsvUpload } from '@/lib/services/csv-upload';
import type { CsvUploadResponse, CsvMappingRequiredResponse } from '@/types/api';
import type { Trade } from '@/types/db';

// ---- Supabase mock ----------------------------------------------------

const PG_UNIQUE_VIOLATION = '23505';

interface InsertCall {
  table: string;
  payload: unknown;
}

function makeMockSupabase(opts: { duplicateAfterCount?: number } = {}) {
  const inserted: Trade[] = [];
  const insertCalls: InsertCall[] = [];
  let tradeSeq = 0;

  // Each call to from(...) returns a fresh chainable builder so different
  // tables don't share state across statements.
  const from = vi.fn((table: string) => {
    let currentPayload: unknown = null;

    const builder: Record<string, unknown> = {
      insert: vi.fn((payload: unknown) => {
        currentPayload = payload;
        insertCalls.push({ table, payload });
        return builder;
      }),
      update: vi.fn(() => builder),
      eq: vi.fn(() => builder),
      select: vi.fn(() => builder),
      maybeSingle: vi.fn(async () => {
        if (table === 'trades') {
          // Simulate duplicate after N rows have been accepted.
          if (
            opts.duplicateAfterCount !== undefined &&
            inserted.length >= opts.duplicateAfterCount
          ) {
            return { data: null, error: { code: PG_UNIQUE_VIOLATION, message: 'duplicate' } };
          }
          tradeSeq += 1;
          const t: Trade = {
            ...(currentPayload as Omit<Trade, 'id' | 'owner_id' | 'created_at'>),
            id: `trade-${tradeSeq}`,
            owner_id: 'user-1',
            session_id: null,
            created_at: '2026-05-20T13:00:00Z',
          } as Trade;
          inserted.push(t);
          return { data: t, error: null };
        }
        return { data: null, error: null };
      }),
      single: vi.fn(async () => {
        if (table === 'csv_uploads') {
          return { data: { id: 'upload-1' }, error: null };
        }
        return { data: null, error: null };
      }),
    };

    return builder;
  });

  const storage = {
    from: vi.fn(() => ({
      upload: vi.fn(async () => ({ error: null })),
    })),
  };

  return {
    client: { from, storage } as unknown as Parameters<typeof handleCsvUpload>[0]['supabase'],
    insertCalls,
    inserted,
  };
}

// ---- Sample CSV (sibling agent provides this fixture) -----------------

function loadSampleCsv(): string {
  const p = path.resolve(__dirname, '../fixtures/sample-ninjatrader.csv');
  return readFileSync(p, 'utf-8');
}

function isUploadResponse(
  r: CsvUploadResponse | CsvMappingRequiredResponse,
): r is CsvUploadResponse {
  return 'uploadId' in r;
}

// ---- Tests ------------------------------------------------------------

describe('handleCsvUpload — ninjatrader sample', () => {
  let mock: ReturnType<typeof makeMockSupabase>;

  beforeEach(() => {
    mock = makeMockSupabase();
  });

  it('returns CsvUploadResponse with accepted > 0', async () => {
    const fileText = loadSampleCsv();
    const result = await handleCsvUpload({
      supabase: mock.client,
      ownerId: 'user-1',
      fileText,
      presetName: 'ninjatrader',
    });

    expect(isUploadResponse(result)).toBe(true);
    if (!isUploadResponse(result)) return;

    expect(result.accepted).toBeGreaterThan(0);
    expect(result.uploadId).toBe('upload-1');
    expect(result.presetUsed).toBe('ninjatrader');
    expect(result.tradeIds.length).toBe(result.accepted);
  });

  it('inserts trade rows with owner_id and required fields', async () => {
    const fileText = loadSampleCsv();
    await handleCsvUpload({
      supabase: mock.client,
      ownerId: 'user-1',
      fileText,
      presetName: 'ninjatrader',
    });

    const tradeInserts = mock.insertCalls.filter((c) => c.table === 'trades');
    expect(tradeInserts.length).toBeGreaterThan(0);
    const sample = tradeInserts[0]?.payload as Record<string, unknown>;
    expect(sample.owner_id).toBe('user-1');
    expect(sample.symbol).toBeDefined();
    expect(['long', 'short']).toContain(sample.side);
    expect(typeof sample.entry_price).toBe('string');
    expect(typeof sample.contracts).toBe('string');
  });

  it('records audit row in csv_uploads', async () => {
    const fileText = loadSampleCsv();
    await handleCsvUpload({
      supabase: mock.client,
      ownerId: 'user-1',
      fileText,
      presetName: 'ninjatrader',
    });

    const auditInserts = mock.insertCalls.filter((c) => c.table === 'csv_uploads');
    expect(auditInserts.length).toBe(1);
    const audit = auditInserts[0]?.payload as Record<string, unknown>;
    expect(audit.owner_id).toBe('user-1');
    expect(audit.preset_used).toBe('ninjatrader');
  });
});

describe('handleCsvUpload — duplicate handling', () => {
  it('flags duplicates on re-upload (silently skips, counts them)', async () => {
    const fileText = loadSampleCsv();

    // First upload: everything new.
    const fresh = makeMockSupabase();
    const first = await handleCsvUpload({
      supabase: fresh.client,
      ownerId: 'user-1',
      fileText,
      presetName: 'ninjatrader',
    });
    expect(isUploadResponse(first)).toBe(true);

    // Second upload simulated by a mock that returns UNIQUE-VIOLATION for every
    // trades.insert from row 0 onward — mimics the same CSV being re-submitted.
    const dup = makeMockSupabase({ duplicateAfterCount: 0 });
    const second = await handleCsvUpload({
      supabase: dup.client,
      ownerId: 'user-1',
      fileText,
      presetName: 'ninjatrader',
    });
    expect(isUploadResponse(second)).toBe(true);
    if (!isUploadResponse(second)) return;
    // Duplicates surface in the `rejected` count (csv-upload.ts behavior).
    expect(second.rejected).toBeGreaterThan(0);
    expect(second.accepted).toBe(0);
  });
});
