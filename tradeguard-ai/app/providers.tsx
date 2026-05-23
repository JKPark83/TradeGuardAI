'use client';

/**
 * Client providers tree.
 *
 * Currently wraps children in a memoized React Query client. Additional
 * client-side providers (theme, toaster, analytics) should be composed here
 * to keep the root server layout server-only.
 */

import { useState, type ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

interface ProvidersProps {
  children: ReactNode;
}

export function Providers({ children }: ProvidersProps): ReactNode {
  // `useState` initializer guarantees one client per browser session and
  // prevents React Strict Mode double-invocation from creating duplicates.
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 30_000,
            retry: 1,
            refetchOnWindowFocus: false,
          },
          mutations: {
            retry: 0,
          },
        },
      }),
  );

  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
}
