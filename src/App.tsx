import { useEffect, useState } from 'react';
import { createBrowserRouter, Navigate, RouterProvider } from 'react-router-dom';
import { DashboardPage } from './pages/DashboardPage';
import { ApplicationPage } from './pages/ApplicationPage';
import { NewApplicationPage } from './pages/NewApplicationPage';
import { EditApplicationPage } from './pages/EditApplicationPage';
import { BaseProfilesPage } from './pages/BaseProfilesPage';
import { BaseProfileEditPage } from './pages/BaseProfileEditPage';
import { LoginPage } from './pages/LoginPage';
import { AccountLayout } from './pages/account/AccountLayout';
import { PasswordSection } from './pages/account/PasswordSection';
import { JobAlertsSection } from './components/JobAlertsSection';
import { ApiTokensSection } from './components/ApiTokensSection';
import { KnowledgePage } from './pages/KnowledgePage';
import { LeadsPage } from './pages/LeadsPage';
import { TrashPage } from './pages/TrashPage';
import { fetchCurrentUser } from './utils/api';
import { AppSkeleton } from './components/Skeleton';
import { hydrate, setStorageBackend } from './utils/storage';
import { DEMO_BASENAME, demoLocale, isDemo, loadDemoData, saveDemoData } from './demo/demoMode';
import { DemoBanner } from './demo/DemoBanner';
import { TourHost } from './tour/TourHost';
import { SeasonalEffect } from './components/SeasonalEffect';

// The demo has no account (password, API tokens), so it has no account page.
const router = createBrowserRouter(
  [
    { path: '/', element: <DashboardPage /> },
    { path: '/profiles', element: <BaseProfilesPage /> },
    ...(isDemo
      ? []
      : [
          {
            path: '/account',
            element: <AccountLayout />,
            children: [
              { index: true, element: <PasswordSection /> },
              { path: 'job-alerts', element: <JobAlertsSection /> },
              { path: 'knowledge', element: <KnowledgePage /> },
              { path: 'tokens', element: <ApiTokensSection /> },
            ],
          },
          { path: '/knowledge', element: <Navigate to="/account/knowledge" replace /> },
          { path: '/leads', element: <LeadsPage /> },
        ]),
    { path: '/profiles/:id', element: <BaseProfileEditPage /> },
    { path: '/trash', element: <TrashPage /> },
    { path: '/application/new', element: <NewApplicationPage /> },
    { path: '/application/:id/edit', element: <EditApplicationPage /> },
    { path: '/application/:id', element: <ApplicationPage /> },
  ],
  isDemo ? { basename: DEMO_BASENAME } : undefined,
);

// The demo skips the login and keeps every edit in this tab, so the server
// (and any real user's data) is never touched.
if (isDemo) {
  setStorageBackend(saveDemoData);
  hydrate(loadDemoData());
  document.documentElement.lang = demoLocale;
}

/** Shows a page for the tour (a path inside the app or the demo), unless it's already the current one. */
function tourNavigate(path: string) {
  const base = isDemo ? DEMO_BASENAME : '';
  const current = window.location.pathname.slice(base.length).replace(/\/$/, '') || '/';
  if (current !== path) void router.navigate(path);
}

type AuthState = { kind: 'loading' } | { kind: 'anonymous' } | { kind: 'ready' } | { kind: 'error'; message: string };

const centered = 'min-h-screen bg-bg flex items-center justify-center font-mono text-[12px]';

// Shows the login until there is a session; each page then loads its own data.
export function App() {
  const [auth, setAuth] = useState<AuthState>(isDemo ? { kind: 'ready' } : { kind: 'loading' });

  useEffect(() => {
    if (isDemo) return;
    fetchCurrentUser()
      .then((user) => setAuth({ kind: user ? 'ready' : 'anonymous' }))
      .catch((e) => setAuth({ kind: 'error', message: e instanceof Error ? e.message : 'Server unreachable.' }));
  }, []);

  if (auth.kind === 'loading') {
    return (
      <>
        <SeasonalEffect />
        <AppSkeleton />
      </>
    );
  }
  if (auth.kind === 'error') {
    return (
      <>
        <SeasonalEffect />
        <div className={`${centered} text-status-rejected`}>{auth.message}</div>
      </>
    );
  }
  if (auth.kind === 'anonymous') {
    return (
      <>
        <SeasonalEffect />
        <LoginPage onLoggedIn={() => setAuth({ kind: 'ready' })} />
      </>
    );
  }

  return (
    <>
      <SeasonalEffect />
      {isDemo && <DemoBanner />}
      <RouterProvider router={router} />
      <TourHost navigate={tourNavigate} />
    </>
  );
}
