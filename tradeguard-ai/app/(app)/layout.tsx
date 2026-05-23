/**
 * Authenticated app shell (route group `(app)`).
 *
 * Server component — verifies the Supabase session and redirects unauthenticated
 * visitors to `/login`. Renders the persistent sidebar nav and top header.
 *
 * The `<TiltIndicator />` (US6) renders a session-scoped Green/Yellow/Red
 * status pill in the top-right of the header, derived from `/api/sessions/active`.
 */

import { redirect } from 'next/navigation';
import Link from 'next/link';
import type { ReactNode } from 'react';
import {
  LayoutDashboard,
  Upload,
  List,
  NotebookPen,
  Gauge,
  Shield,
  Timer,
  UserCircle2,
  LogOut,
} from 'lucide-react';
import { createClient } from '@/lib/supabase/server';
import { cn } from '@/lib/utils/cn';
import { TiltIndicator } from '@/components/layout/TiltIndicator';

interface NavItem {
  href: string;
  label: string;
  icon: typeof LayoutDashboard;
}

const NAV: NavItem[] = [
  { href: '/dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { href: '/upload', label: '거래 업로드', icon: Upload },
  { href: '/trades', label: '거래 목록', icon: List },
  { href: '/retrospective', label: '회고', icon: NotebookPen },
  { href: '/risk', label: '위험도 평가', icon: Gauge },
  { href: '/prop-firm', label: 'Prop Firm', icon: Shield },
  { href: '/session', label: '세션', icon: Timer },
  { href: '/account', label: '계정', icon: UserCircle2 },
];

async function signOutAction(): Promise<void> {
  'use server';
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect('/login');
}

interface AppLayoutProps {
  children: ReactNode;
}

export default async function AppLayout({ children }: AppLayoutProps): Promise<ReactNode> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect('/login');
  }

  return (
    <div className="flex min-h-screen w-full">
      <aside
        className={cn(
          'flex flex-col border-r border-border bg-muted/30',
          'w-16 lg:w-56 shrink-0 transition-[width] duration-150',
        )}
        aria-label="주요 메뉴"
      >
        <div className="flex h-14 items-center justify-center lg:justify-start lg:px-4 border-b border-border">
          <span className="hidden lg:inline text-sm font-semibold tracking-wider terminal-glow">
            TradeGuard
          </span>
          <span className="lg:hidden text-sm font-semibold">TG</span>
        </div>
        <nav className="flex-1 overflow-y-auto py-2">
          <ul className="flex flex-col gap-0.5 px-2">
            {NAV.map(({ href, label, icon: Icon }) => (
              <li key={href}>
                <Link
                  href={href}
                  className={cn(
                    'flex items-center gap-3 rounded-md px-2 py-2 text-sm',
                    'text-muted-foreground hover:text-foreground hover:bg-muted/60',
                    'focus-visible:bg-muted/60',
                  )}
                >
                  <Icon className="h-4 w-4 shrink-0" aria-hidden />
                  <span className="hidden lg:inline">{label}</span>
                  <span className="sr-only lg:hidden">{label}</span>
                </Link>
              </li>
            ))}
          </ul>
        </nav>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-14 items-center justify-between gap-4 border-b border-border px-4">
          <div className="flex items-center gap-4 min-w-0">
            <span className="text-sm font-semibold tracking-wider lg:hidden">TradeGuard</span>
            <TiltIndicator />
          </div>
          <div className="flex items-center gap-3">
            <span
              className="hidden sm:inline rounded-full border border-border bg-muted/40 px-3 py-1 text-xs text-muted-foreground"
              title={user.email ?? ''}
            >
              {user.email ?? '익명 사용자'}
            </span>
            <form action={signOutAction}>
              <button
                type="submit"
                className={cn(
                  'inline-flex items-center gap-1.5 rounded-md border border-border px-2.5 py-1.5 text-xs',
                  'text-muted-foreground hover:text-foreground hover:bg-muted/60',
                )}
                aria-label="로그아웃"
              >
                <LogOut className="h-3.5 w-3.5" aria-hidden />
                <span>로그아웃</span>
              </button>
            </form>
          </div>
        </header>
        <main className="flex-1 overflow-y-auto p-4 lg:p-6">{children}</main>
      </div>
    </div>
  );
}
