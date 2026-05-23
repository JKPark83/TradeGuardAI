/**
 * `/dashboard` — primary post-login surface.
 *
 * Server component that fetches the four backing endpoints in parallel using
 * the request's own cookies (forwarded explicitly to the internal `/api/*`
 * routes — Next does not auto-forward when calling the same origin server-side).
 *
 * If the user has not uploaded enough trades for the deterministic analysis
 * to produce a meaningful profile (`minimumTradesReached === false`), we
 * short-circuit to an empty-state card pointing at `/upload` instead of
 * rendering noisy zero-filled charts.
 */

import type { ReactNode } from 'react';
import Link from 'next/link';
import { cookies, headers } from 'next/headers';
import { Shield, Upload } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { BehavioralProfileCard } from '@/components/trades/BehavioralProfileCard';
import { HourlyWinRateChart } from '@/components/charts/HourlyWinRateChart';
import { AtrBucketChart } from '@/components/charts/AtrBucketChart';
import { TradesTable } from '@/components/trades/TradesTable';
import { UpcomingEventsWidget } from '@/components/market/UpcomingEventsWidget';
import { cn } from '@/lib/utils/cn';
import type {
  AtrBucket,
  BehavioralProfileResponse,
  HourlyWinRateBucket,
  PropFirmProfileResponse,
  TradesListResponse,
} from '@/types/api';

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

async function safeFetch<T>(url: string, cookieHeader: string): Promise<T | null> {
  try {
    const res = await fetch(url, { cache: 'no-store', headers: { cookie: cookieHeader } });
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

interface HourlyWinRateApi {
  buckets: HourlyWinRateBucket[];
}
interface AtrBucketApi {
  buckets: AtrBucket[];
}
interface PropFirmListApi {
  profiles: PropFirmProfileResponse[];
}

export default async function DashboardPage(): Promise<ReactNode> {
  const { base, cookieHeader } = await buildFetchContext();

  const [profile, hourly, atr, trades, propFirm] = await Promise.all([
    safeFetch<BehavioralProfileResponse>(`${base}/api/analysis/profile`, cookieHeader),
    safeFetch<HourlyWinRateApi>(`${base}/api/analysis/hourly-winrate`, cookieHeader),
    safeFetch<AtrBucketApi>(`${base}/api/analysis/atr-buckets`, cookieHeader),
    safeFetch<TradesListResponse>(`${base}/api/trades?limit=10`, cookieHeader),
    safeFetch<PropFirmListApi>(`${base}/api/prop-firm-profiles`, cookieHeader),
  ]);

  const minimumReached = profile?.minimumTradesReached ?? false;
  const firstActiveProp = propFirm?.profiles.find((p) => p.isActive) ?? null;

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-1.5">
        <h1 className="text-xl font-semibold tracking-tight">Dashboard</h1>
        <p className="text-xs text-muted-foreground">
          나의 매매 행동을 정량 지표로 진단합니다. 추측이 아닌 패턴.
        </p>
      </header>

      {!minimumReached ? (
        <Card>
          <CardHeader>
            <CardTitle>분석을 위한 최소 거래 수에 도달하지 못했습니다</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            <p className="text-sm text-muted-foreground">
              최소 거래 수에 도달하지 못함. CSV를 업로드해 시작하세요.
            </p>
            <Link href="/upload" className="self-start">
              <Button size="sm">
                <Upload className="h-3.5 w-3.5" /> CSV 업로드로 이동
              </Button>
            </Link>
          </CardContent>
        </Card>
      ) : (
        <>
          {profile ? <BehavioralProfileCard profile={profile} /> : null}

          <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
            {hourly ? <HourlyWinRateChart buckets={hourly.buckets} /> : null}
            {atr ? <AtrBucketChart buckets={atr.buckets} /> : null}
          </div>

          <PropFirmSummary profile={firstActiveProp} />

          <UpcomingEventsWidget />

          <Card>
            <CardHeader className="flex flex-row items-center justify-between">
              <CardTitle>최근 거래</CardTitle>
              <Link href="/trades" className="text-xs text-muted-foreground hover:text-foreground">
                전체 보기 →
              </Link>
            </CardHeader>
            <CardContent>
              <TradesTable trades={trades?.trades ?? []} />
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}

interface PropFirmSummaryProps {
  profile: PropFirmProfileResponse | null;
}

function PropFirmSummary({ profile }: PropFirmSummaryProps): ReactNode {
  if (!profile) {
    return (
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle>Prop Firm 룰 여유</CardTitle>
          <Link href="/prop-firm" className="text-xs text-muted-foreground hover:text-foreground">
            등록하기 →
          </Link>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">
            프로필 미등록 — 펀딩 회사·드로우다운 한도를 등록하면 룰 여유가 표시됩니다.
          </p>
        </CardContent>
      </Card>
    );
  }

  const room = profile.currentRoom;
  const warning = room?.warningActive === true;
  const dailyRoom = room?.dailyLossRoom ?? null;
  const drawdownRoom = room?.drawdownRoom ?? null;

  return (
    <Card className={cn(warning && 'border-tilt-red/50')}>
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle className="flex items-center gap-2">
          <Shield className="h-4 w-4 text-muted-foreground" aria-hidden />
          Prop Firm 룰 여유 — {profile.firmLabel ?? profile.firmName}
        </CardTitle>
        <Link href="/prop-firm" className="text-xs text-muted-foreground hover:text-foreground">
          전체 보기 →
        </Link>
      </CardHeader>
      <CardContent className="grid grid-cols-2 gap-4">
        <div className="flex flex-col gap-1">
          <span className="text-xs uppercase tracking-wider text-muted-foreground">
            오늘 추가 허용 손실
          </span>
          <span
            className={cn(
              'text-2xl font-semibold tabular-nums',
              warning ? 'text-tilt-red' : 'text-tilt-green',
            )}
          >
            {dailyRoom !== null ? `$${Math.round(dailyRoom).toLocaleString()}` : '—'}
          </span>
        </div>
        <div className="flex flex-col gap-1">
          <span className="text-xs uppercase tracking-wider text-muted-foreground">
            드로우다운 여유
          </span>
          <span
            className={cn(
              'text-2xl font-semibold tabular-nums',
              warning ? 'text-tilt-red' : 'text-tilt-green',
            )}
          >
            {drawdownRoom !== null ? `$${Math.round(drawdownRoom).toLocaleString()}` : '—'}
          </span>
        </div>
      </CardContent>
    </Card>
  );
}
