'use client';

/**
 * <LoginForm /> — Client component for OAuth + (dev-only) magic link sign-in.
 *
 * Buttons:
 *  - Google OAuth (production primary)
 *  - Kakao OAuth (production primary, KR market)
 *  - Email magic link (development only — Inbucket inbox at :54324)
 *
 * The dev-only Server Action is passed in as a prop from page.tsx so that
 * this file stays purely client-side and the action remains tree-shakeable
 * out of the client bundle.
 */

import { useActionState, useState } from 'react';
import { createClient } from '@/lib/supabase/client';

type Provider = 'google' | 'kakao';

type MagicLinkState = { ok: boolean; error: string | null };
type MagicLinkAction = (state: MagicLinkState, formData: FormData) => Promise<MagicLinkState>;

const INITIAL_STATE: MagicLinkState = { ok: false, error: null };

export default function LoginForm({
  isDev,
  sendMagicLinkAction,
}: {
  isDev: boolean;
  sendMagicLinkAction: MagicLinkAction;
}) {
  const [loadingProvider, setLoadingProvider] = useState<Provider | null>(null);
  const [oauthError, setOauthError] = useState<string | null>(null);
  const [magicState, runMagicLink, isMagicPending] = useActionState<MagicLinkState, FormData>(
    sendMagicLinkAction,
    INITIAL_STATE,
  );

  async function handleOAuth(provider: Provider) {
    setOauthError(null);
    setLoadingProvider(provider);
    try {
      const supabase = createClient();
      const redirectTo = `${window.location.origin}/callback`;
      const { error } = await supabase.auth.signInWithOAuth({
        provider,
        options: { redirectTo },
      });
      if (error) {
        setOauthError(`로그인 실패: ${error.message}`);
        setLoadingProvider(null);
      }
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      setOauthError(`로그인 실패: ${message}`);
      setLoadingProvider(null);
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <button
        type="button"
        onClick={() => handleOAuth('google')}
        disabled={loadingProvider !== null}
        className="rounded-lg border border-gray-300 bg-white px-4 py-3 text-sm font-medium text-gray-800 shadow-sm transition hover:bg-gray-50 disabled:opacity-50"
      >
        {loadingProvider === 'google' ? '이동 중…' : 'Sign in with Google'}
      </button>

      <button
        type="button"
        onClick={() => handleOAuth('kakao')}
        disabled={loadingProvider !== null}
        className="rounded-lg bg-[#FEE500] px-4 py-3 text-sm font-medium text-[#191600] shadow-sm transition hover:brightness-95 disabled:opacity-50"
      >
        {loadingProvider === 'kakao' ? '이동 중…' : '카카오로 로그인'}
      </button>

      {isDev && (
        <form
          action={runMagicLink}
          className="mt-4 flex flex-col gap-2 border-t border-gray-200 pt-4"
        >
          <label htmlFor="email" className="text-xs font-medium text-gray-500">
            개발용 매직 링크 (Inbucket: http://127.0.0.1:54324)
          </label>
          <div className="flex gap-2">
            <input
              id="email"
              name="email"
              type="email"
              required
              placeholder="you@example.com"
              className="flex-1 rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"
            />
            <button
              type="submit"
              disabled={isMagicPending}
              className="rounded-md bg-gray-900 px-3 py-2 text-sm font-medium text-white hover:bg-gray-800 disabled:opacity-50"
            >
              {isMagicPending ? '전송 중…' : '링크 전송'}
            </button>
          </div>
          {magicState.ok && (
            <p className="text-xs text-green-600">
              매직 링크가 전송되었습니다. Inbucket 받은편지함을 확인하세요.
            </p>
          )}
          {magicState.error && <p className="text-xs text-red-600">{magicState.error}</p>}
        </form>
      )}

      {oauthError && (
        <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{oauthError}</p>
      )}
    </div>
  );
}
