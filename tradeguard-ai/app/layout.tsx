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
      </body>
    </html>
  );
}
