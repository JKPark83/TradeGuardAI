/**
 * Vitest global setup.
 *
 * Responsibilities:
 *   1. Start the MSW Node server before any test runs; reset handlers between
 *      tests so handler overrides in one test don't leak into the next.
 *   2. Force `onUnhandledRequest: 'error'` so accidental real-network calls
 *      fail loudly during local + CI runs.
 *   3. Pin `crypto.randomBytes` to a deterministic sequence so any code that
 *      derives nonces / salts / IDs produces stable hashes in snapshots.
 *   4. Inject a non-secret `PII_HMAC_SECRET` so HMAC-based PII redaction can
 *      run end-to-end in tests without leaking the prod secret.
 */

import { afterAll, afterEach, beforeAll, vi } from 'vitest';
import nodeCrypto from 'node:crypto';
import { server } from '../mocks/server';

// --- Environment --------------------------------------------------------
process.env.PII_HMAC_SECRET = 'test-secret-do-not-use-in-prod';

// --- Deterministic randomness ------------------------------------------
// A short, repeating byte pattern keeps every test run identical without
// pinning a single value (which would collide if multiple calls happen
// in one test).
const FIXED_BYTES = Uint8Array.from([
  0xde, 0xad, 0xbe, 0xef, 0xca, 0xfe, 0xba, 0xbe, 0x01, 0x23, 0x45, 0x67, 0x89, 0xab, 0xcd, 0xef,
]);

function fillFromFixed(size: number, offset: { value: number }): Buffer {
  const out = Buffer.alloc(size);
  for (let i = 0; i < size; i += 1) {
    out[i] = FIXED_BYTES[offset.value % FIXED_BYTES.length] ?? 0;
    offset.value += 1;
  }
  return out;
}

const cursor = { value: 0 };
vi.spyOn(nodeCrypto, 'randomBytes').mockImplementation(((
  size: number,
  cb?: (err: Error | null, buf: Buffer) => void,
) => {
  const buf = fillFromFixed(size, cursor);
  if (typeof cb === 'function') {
    cb(null, buf);
    return undefined as unknown as Buffer;
  }
  return buf;
}) as typeof nodeCrypto.randomBytes);

// --- MSW lifecycle ------------------------------------------------------
beforeAll(() => {
  server.listen({ onUnhandledRequest: 'error' });
});

afterEach(() => {
  server.resetHandlers();
  cursor.value = 0;
});

afterAll(() => {
  server.close();
});
