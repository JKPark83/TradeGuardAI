/**
 * Root server layout.
 *
 * Sets the document shell (`<html lang="ko">`), applies the default dark
 * theme class, and wraps children in client-side Providers. Page-specific
 * chrome (sidebar, header, tilt indicator) lives in route-group layouts
 * such as `app/(app)/layout.tsx`.
 */

import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { Analytics } from '@vercel/analytics/react';
import { SpeedInsights } from '@vercel/speed-insights/next';
import { Providers } from './providers';
import './globals.css';

export const metadata: Metadata = {
  title: 'TradeGuard AI',
  description: '해외선물 리스크 가드레일 시스템',
};

interface RootLayoutProps {
  children: ReactNode;
}

export default function RootLayout({ children }: RootLayoutProps): ReactNode {
  return (
    <html lang="ko" className="dark" suppressHydrationWarning>
      <body className="min-h-screen bg-background text-foreground font-mono antialiased">
        <Providers>{children}</Providers>
        {/*
          Vercel Analytics + Speed Insights — opt-in observability for the
          deployed app. Both components are no-ops in dev / when the script
          can't reach Vercel's edge (e.g., self-hosted). PII-safe by default.
        */}
        <Analytics />
        <SpeedInsights />
      </body>
    </html>
  );
}
