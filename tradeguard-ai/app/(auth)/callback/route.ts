/**
 * /callback — OAuth + magic-link redirect handler.
 *
 * Supabase Auth redirects here with `?code=...` after the user authenticates
 * with Google/Kakao (or clicks a magic link in dev). We exchange the code
 * for a session (which sets the `sb-*` cookies via @supabase/ssr), then
 * provision the per-user PII HMAC secret before sending the user onward.
 */

import { NextResponse, type NextRequest } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { ensureUserSecret } from '@/lib/auth/ensure-user-secret';
import { logger } from '@/lib/utils/logger';

export const dynamic = 'force-dynamic';

// Opaque error codes for the login UI. Raw Supabase error messages are NEVER
// surfaced to the client — they may contain internal token/PII fragments.
type CallbackErrorCode = 'missing_code' | 'invalid_code' | 'session_error' | 'server_error';

export async function GET(request: NextRequest): Promise<NextResponse> {
  const requestUrl = new URL(request.url);
  const code = requestUrl.searchParams.get('code');
  const next = requestUrl.searchParams.get('next') ?? '/dashboard';
  const origin = requestUrl.origin;

  const redirectWithError = (errorCode: CallbackErrorCode): NextResponse =>
    NextResponse.redirect(`${origin}/login?error=${errorCode}`);

  if (!code) return redirectWithError('missing_code');

  try {
    const supabase = await createClient();
    const { error: exchangeError } = await supabase.auth.exchangeCodeForSession(code);
    if (exchangeError) {
      logger.warn('oauth_exchange_failed', { code: exchangeError.code });
      return redirectWithError('invalid_code');
    }
    await ensureUserSecret();
  } catch (e) {
    logger.error('callback_unexpected_error', {
      message: e instanceof Error ? e.message : String(e),
    });
    return redirectWithError('server_error');
  }

  const safeNext = next.startsWith('/') && !next.startsWith('//') ? next : '/dashboard';
  return NextResponse.redirect(`${origin}${safeNext}`);
}
