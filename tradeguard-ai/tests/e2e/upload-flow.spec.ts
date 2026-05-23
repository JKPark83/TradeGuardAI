/**
 * E2E — CSV upload happy path (US1).
 *
 * Covers the Acceptance Scenario from spec.md US1.1:
 *   Given a logged-in user with an empty dashboard,
 *   When they upload a valid CSV,
 *   Then trades are stored and dashboard shows summary stats.
 *
 * Auth is stubbed via cookie injection — we don't run real OAuth in CI.
 *
 * TODO(US1): unskip when the PR pipeline (auth cookie spec, /upload + /trades
 * routes, Supabase fixture data) is wired. The skeleton is left in place so
 * that flipping `test.skip` → `test` is the only change needed.
 */

import { test, expect, type BrowserContext } from '@playwright/test';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const STUB_AUTH_COOKIE = {
  // TODO(US1): replace placeholder with the real Supabase auth cookie shape
  // once the auth helper exposes a test-mode token issuer.
  name: 'sb-access-token',
  value: 'test-token-placeholder',
  domain: 'localhost',
  path: '/',
  httpOnly: true,
  secure: false,
  sameSite: 'Lax' as const,
};

async function injectAuthCookie(context: BrowserContext): Promise<void> {
  await context.addCookies([STUB_AUTH_COOKIE]);
}

const SAMPLE_CSV_PATH = path.resolve(__dirname, '../fixtures/sample-ninjatrader.csv');

test.describe('US1 — CSV upload + dashboard render', () => {
  // TODO(US1): remove .skip once auth stub + routes are live.
  test.skip('user uploads a CSV and sees populated dashboard', async ({ page, context }) => {
    await injectAuthCookie(context);

    await page.goto('/upload');

    // Drag-drop via the file input the dropzone wraps.
    const input = page.locator('input[type="file"]');
    await input.setInputFiles(SAMPLE_CSV_PATH);

    // Success surfaces either as a toast or a redirect to /dashboard.
    await expect(page.getByText(/업로드 완료|upload complete/i)).toBeVisible({
      timeout: 10_000,
    });

    // Verify the trades table on /trades is populated.
    await page.goto('/trades');
    const rows = page.locator('[data-testid="trade-row"]');
    await expect(rows.first()).toBeVisible({ timeout: 10_000 });
    expect(await rows.count()).toBeGreaterThan(0);
  });

  // TODO(US1): remove .skip — covers the spec.md US1.3 negative path.
  test.skip('invalid CSV shows row-level error without partial save', async ({ page, context }) => {
    await injectAuthCookie(context);
    await page.goto('/upload');

    // A malformed CSV with a pnl-sign mismatch row.
    const badCsv = path.resolve(__dirname, '../fixtures/sample-ninjatrader-invalid.csv');
    await page.locator('input[type="file"]').setInputFiles(badCsv);

    // User must see WHICH row + column failed.
    await expect(page.getByText(/pnl_mismatch|손익 불일치/i)).toBeVisible({
      timeout: 10_000,
    });
  });
});
