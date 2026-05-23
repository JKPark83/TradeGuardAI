// /account — 계정 설정 페이지. v1에서는 데이터 전체 삭제만 노출.
// (FR-019, SC-006) 확인 토큰을 직접 타이핑해야 진행되도록 강제.

import { redirect } from 'next/navigation';

import { createClient } from '@/lib/supabase/server';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { AccountDeleteSection } from './AccountDeleteSection';

export const dynamic = 'force-dynamic';

export default async function AccountPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  return (
    <main className="mx-auto max-w-3xl px-4 py-10 space-y-8">
      <header>
        <h1 className="text-2xl font-bold">계정 설정</h1>
        <p className="text-sm text-muted-foreground mt-1">
          {user.email ?? '(이메일 없음)'} 로 로그인됨
        </p>
      </header>

      <Card>
        <CardHeader>
          <CardTitle>내 데이터</CardTitle>
          <CardDescription>
            업로드된 거래, 분석, 회고, Prop Firm 프로필, 세션·Tilt 기록을 모두 영구 삭제합니다.
            삭제 후에는 복구할 수 없습니다.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <AccountDeleteSection />
        </CardContent>
      </Card>
    </main>
  );
}
