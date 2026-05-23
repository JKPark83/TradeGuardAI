/**
 * `/session` — trading session control page (server shell).
 *
 * Fetches the active session server-side (with cookie forwarding to the
 * internal /api route) so the client renders with no flicker. The actual
 * start/end/tilt flow lives in `<SessionPanel />`.
 */

import type { ReactNode } from 'react';
import { cookies, headers } from 'next/headers';
import { SessionPanel } from './SessionPanel';
import type { ActiveSessionResponse } from '@/types/api';

export const dynamic = 'force-dynamic';

async function buildFetchContext(): Promise<{ base: string; cookieHeader: string }> {
  const h = await headers();
  const c = await cookies();
  const host = h.get('host');
  const proto = h.get('x-forwarded-proto') ?? 'http';
  const base = host
    ? `${proto}://${host}`
    : (process.env.NEXT_PUBLIC_SITE_URL ?? 'http://localhost:3000');
  const cookieHeader = c
    .getAll()
    .map(({ name, value }) => `${name}=${value}`)
    .join('; ');
  return { base, cookieHeader };
}

async function safeFetchActive(): Promise<ActiveSessionResponse> {
  const { base, cookieHeader } = await buildFetchContext();
  try {
    const res = await fetch(`${base}/api/sessions/active`, {
      cache: 'no-store',
      headers: { cookie: cookieHeader },
    });
    if (!res.ok) return { activeSession: null };
    return (await res.json()) as ActiveSessionResponse;
  } catch {
    return { activeSession: null };
  }
}

export default async function SessionPage(): Promise<ReactNode> {
  const initial = await safeFetchActive();

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-1.5">
        <h1 className="text-xl font-semibold tracking-tight">거래 세션</h1>
        <p className="text-xs text-muted-foreground">
          세션 시작 시 30초 멘탈 체크인으로 Tilt Score(Green/Yellow/Red)를 산출합니다.
        </p>
      </header>
      <SessionPanel initialActive={initial} />
    </div>
  );
}
