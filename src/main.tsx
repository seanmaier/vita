import { StrictMode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createRoot } from 'react-dom/client';
import './styles/tokens.css';
import './styles/seasonalEffect.css';
import './index.css';
import { App } from './App';
import { applyStoredTheme } from './hooks/useTheme';
import { DataBackendProvider, serverBackend } from './api/backend';
import { localBackend } from './api/localBackend';
import { isDemo } from './demo/demoMode';

applyStoredTheme();

// Server data is cached per resource and refetched when the tab comes back
// into view, so changes made elsewhere (another device, /api/v1) show up.
const queryClient = new QueryClient({ defaultOptions: { queries: { retry: 1 } } });

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      {/* The demo keeps its data in this tab and never talks to the server. */}
      <DataBackendProvider value={isDemo ? localBackend : serverBackend}>
        <App />
      </DataBackendProvider>
    </QueryClientProvider>
  </StrictMode>,
);
