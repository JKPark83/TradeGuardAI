/**
 * Next.js middleware — refreshes Supabase session on every request and
 * redirects unauthenticated users to /login.
 *
 * Critical implementation notes (per @supabase/ssr v0.5+ docs):
 *  - We construct a *fresh* NextResponse on every call so cookies set by
 *    Supabase end up on both the request (forwarded to the route) and the
 *    outgoing response (sent to the browser).
 *  - `supabase.auth.getUser()` MUST be called before returning the response,
 *    because it triggers token refresh which writes cookies via setAll.
 *  - Public paths (login/callback/api auth/static assets) bypass auth.
 */

import { NextResponse, type NextRequest } from 'next/server';
import { createServerClient } from '@supabase/ssr';

const PUBLIC_PATH_PREFIXES = ['/login', '/callback', '/api/auth'];

function isPublicPath(pathname: string): boolean {
  return PUBLIC_PATH_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
  );
}

export async function middleware(request: NextRequest): Promise<NextResponse> {
  let response = NextResponse.next({ request });

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anonKey) {
    // Fail loud in every environment — auth bypass is unacceptable in prod.
    return new NextResponse('Service misconfigured: missing Supabase credentials', {
      status: 503,
    });
  }

  const supabase = createServerClient(url, anonKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet: { name: string; value: string; options?: Record<string, unknown> }[]) {
        for (const { name, value } of cookiesToSet) {
          request.cookies.set(name, value);
        }
        response = NextResponse.next({ request });
        for (const { name, value, options } of cookiesToSet) {
          response.cookies.set(name, value, options);
        }
      },
    },
  });

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user && !isPublicPath(request.nextUrl.pathname)) {
    const loginUrl = request.nextUrl.clone();
    loginUrl.pathname = '/login';
    loginUrl.searchParams.set('next', request.nextUrl.pathname);
    return NextResponse.redirect(loginUrl);
  }

  return response;
}

export const config = {
  // Skip Next internals and common static assets; the auth check inside
  // middleware further whitelists /login, /callback, /api/auth.
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|css|js|map|woff|woff2|ttf)$).*)',
  ],
};
