import type { ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { DataBackendProvider, localBackend } from '../api/backend';

/**
 * Wraps a component under test the way main.tsx wraps the app, with the
 * backend that keeps data in the tab's storage (as in the demo) and a fresh
 * cache per test.
 */
export function withData(ui: ReactNode) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return (
    <QueryClientProvider client={queryClient}>
      <DataBackendProvider value={localBackend}>{ui}</DataBackendProvider>
    </QueryClientProvider>
  );
}
