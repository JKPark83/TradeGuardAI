// Root route `/` — auth-aware splash.
//
// The app has no real "marketing" landing page (single-user SaaS — every visitor
// is the owner). We just decide where to send them:
//   - 인증된 사용자 → /dashboard
//   - 비인증 사용자 → /login
//
// This must be a server component so the Supabase session check runs on the
// edge before any client JS loads — otherwise a flash of redirecting content
// would show, and unauthenticated users could briefly see authed UI shells.

import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';

export default async function RootPage(): Promise<never> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  redirect(user ? '/dashboard' : '/login');
}
