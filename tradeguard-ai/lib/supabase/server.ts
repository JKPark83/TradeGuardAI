/**
 * Server-side Supabase client for React Server Components and Route Handlers.
 *
 * Uses `@supabase/ssr`'s `createServerClient` with the Next.js App Router
 * `cookies()` helper from `next/headers`. The `setAll` adapter wraps writes
 * in a try/catch because RSCs are not allowed to set cookies — only Route
 * Handlers and Server Actions are. In RSC contexts, session refresh is
 * handled by `middleware.ts`, so the swallowed error is intentional.
 *
 * v0.5+ API: uses `getAll` / `setAll` (the deprecated `get`/`set`/`remove`
 * triple is no longer recommended).
 */

import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import type { SupabaseClient } from '@supabase/supabase-js';

export async function createClient(): Promise<SupabaseClient> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!url) {
    throw new Error('Missing env var NEXT_PUBLIC_SUPABASE_URL.');
  }
  if (!anonKey) {
    throw new Error('Missing env var NEXT_PUBLIC_SUPABASE_ANON_KEY.');
  }

  const cookieStore = await cookies();

  return createServerClient(url, anonKey, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet: { name: string; value: string; options?: Record<string, unknown> }[]) {
        try {
          for (const { name, value, options } of cookiesToSet) {
            cookieStore.set(name, value, options);
          }
        } catch {
          // RSCs cannot write cookies; middleware refreshes sessions instead.
          // This catch is intentional — see @supabase/ssr Next.js guide.
        }
      },
    },
  });
}
