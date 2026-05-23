/**
 * ensureUserSecret — idempotently provision a per-user PII HMAC secret.
 *
 * Called from the OAuth callback Route Handler (and safe to call again on
 * subsequent logins). Generates 32 random bytes (64 hex chars) and inserts
 * into `public.user_secrets`. RLS on that table is restrictive (owner-only
 * SELECT/INSERT for authenticated users), but we go through the service
 * role anyway so the insert is reliable even before the auth cookie is
 * fully established post-exchange.
 *
 * Server-only — must never be imported from a Client Component.
 */

import 'server-only';

import { randomBytes } from 'node:crypto';
import { createClient as createServerSupabase } from '@/lib/supabase/server';
import { createClient as createSbClient } from '@supabase/supabase-js';
import type { SupabaseClient } from '@supabase/supabase-js';

// Module-scoped lazy singleton to avoid creating a new HTTP client + connection
// pool on every OAuth callback (would leak under bursts of concurrent logins).
let _adminClient: SupabaseClient | null = null;

function getServiceRoleClient(): SupabaseClient {
  if (_adminClient) return _adminClient;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url) {
    throw new Error('Missing env var NEXT_PUBLIC_SUPABASE_URL.');
  }
  if (!serviceRoleKey) {
    throw new Error(
      'Missing env var SUPABASE_SERVICE_ROLE_KEY — required to bypass user_secrets RLS.',
    );
  }
  _adminClient = createSbClient(url, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return _adminClient;
}

export async function ensureUserSecret(): Promise<void> {
  const supabase = await createServerSupabase();
  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();

  if (userError) {
    throw new Error(`ensureUserSecret: failed to load user — ${userError.message}`);
  }
  if (!user) {
    throw new Error('ensureUserSecret: no authenticated user in session.');
  }

  const admin = getServiceRoleClient();

  const { data: existing, error: selectError } = await admin
    .from('user_secrets')
    .select('user_id')
    .eq('user_id', user.id)
    .maybeSingle();

  if (selectError) {
    throw new Error(`ensureUserSecret: SELECT failed — ${selectError.message}`);
  }
  if (existing) {
    return;
  }

  const piiHmacSecret = randomBytes(32).toString('hex');

  const { error: insertError } = await admin
    .from('user_secrets')
    .insert({ user_id: user.id, pii_hmac_secret: piiHmacSecret });

  if (insertError) {
    // Tolerate race: another concurrent login may have just inserted (PK conflict).
    if (insertError.code === '23505') {
      return;
    }
    throw new Error(`ensureUserSecret: INSERT failed — ${insertError.message}`);
  }
}
