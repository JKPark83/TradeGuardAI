/**
 * Browser-side Supabase client.
 *
 * Used from Client Components (`'use client'`) to invoke auth, realtime,
 * and RLS-scoped queries. Cookies are managed by the browser; this client
 * relies on `@supabase/ssr` to share session state with the server client
 * via cookie storage (`sb-*` cookies set by middleware / route handlers).
 *
 * Do NOT import this from a Server Component — use `./server.ts` instead.
 */

import { createBrowserClient } from '@supabase/ssr';
import type { SupabaseClient } from '@supabase/supabase-js';

export function createClient(): SupabaseClient {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!url) {
    throw new Error(
      'Missing env var NEXT_PUBLIC_SUPABASE_URL — set it in .env.local (see .env.example).',
    );
  }
  if (!anonKey) {
    throw new Error(
      'Missing env var NEXT_PUBLIC_SUPABASE_ANON_KEY — set it in .env.local (see .env.example).',
    );
  }

  return createBrowserClient(url, anonKey);
}
