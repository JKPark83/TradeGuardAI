/**
 * /login — Server Component.
 *
 * If the visitor already has a valid session, redirect straight to /dashboard.
 * Otherwise render <LoginForm /> with provider buttons. The dev-only magic-
 * link Server Action is declared inline here and passed down as a prop so
 * `LoginForm` (a Client Component) can invoke it.
 */

import { redirect } from 'next/navigation';
import { headers } from 'next/headers';
import { createClient } from '@/lib/supabase/server';
import LoginForm from './LoginForm';

export const dynamic = 'force-dynamic';

async function sendMagicLink(
  _prevState: { ok: boolean; error: string | null },
  formData: FormData,
): Promise<{ ok: boolean; error: string | null }> {
  'use server';

  if (process.env.NODE_ENV === 'production') {
    return { ok: false, error: '운영 환경에서는 이메일 매직 링크를 사용할 수 없습니다.' };
  }
  const email = formData.get('email');
  if (typeof email !== 'string' || email.length === 0) {
    return { ok: false, error: '이메일을 입력해주세요.' };
  }

  const hdrs = await headers();
  const host = hdrs.get('host') ?? 'localhost:3000';
  const protocol = host.startsWith('localhost') || host.startsWith('127.') ? 'http' : 'https';
  const emailRedirectTo = `${protocol}://${host}/callback`;

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithOtp({
    email,
    options: { emailRedirectTo },
  });
  if (error) {
    return { ok: false, error: error.message };
  }
  return { ok: true, error: null };
}

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (user) {
    redirect('/dashboard');
  }

  const { error } = await searchParams;
  const isDev = process.env.NODE_ENV === 'development';

  return (
    <main className="flex min-h-screen items-center justify-center bg-gray-50 px-4">
      <div className="w-full max-w-sm rounded-2xl border border-gray-200 bg-white p-8 shadow-sm">
        <div className="mb-6 text-center">
          <h1 className="text-2xl font-semibold text-gray-900">TradeGuard AI에 로그인</h1>
          <p className="mt-2 text-sm text-gray-500">사용자 행동 리스크 가드레일</p>
        </div>

        {error && (
          <p className="mb-4 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">
            로그인 중 오류가 발생했습니다: {error}
          </p>
        )}

        <LoginForm isDev={isDev} sendMagicLinkAction={sendMagicLink} />

        <p className="mt-6 text-center text-xs text-gray-400">
          계속 진행하면 서비스 약관 및 개인정보 처리방침에 동의하는 것으로 간주됩니다.
        </p>
      </div>
    </main>
  );
}
