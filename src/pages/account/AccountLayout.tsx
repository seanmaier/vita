import { useEffect, useState } from 'react';
import { Link, NavLink, Outlet } from 'react-router-dom';
import { fetchCurrentUser } from '../../utils/api';
import { tabClass } from '../../styles/formStyles';

export type AccountOutletContext = { username: string | null; admin: boolean };

const SECTIONS = [
  { to: '/account', label: 'password', end: true },
  { to: '/account/job-alerts', label: 'job alerts', end: false },
  { to: '/account/knowledge', label: 'knowledge', end: false },
  { to: '/account/tokens', label: 'api tokens', end: false },
];

export function AccountLayout() {
  const [username, setUsername] = useState<string | null>(null);
  const [admin, setAdmin] = useState(false);

  useEffect(() => {
    fetchCurrentUser()
      .then((u) => {
        setUsername(u?.username ?? null);
        setAdmin(u?.admin === true);
      })
      .catch(() => {});
  }, []);

  return (
    <div className="min-h-screen bg-bg pt-6 px-4 pb-32 max-w-[900px] mx-auto sm:pt-12 sm:px-8">
      <header className="mb-6 sm:mb-8 font-mono text-[15px] flex flex-wrap items-center gap-x-5 gap-y-1">
        <Link className="text-[11px] text-ink-3 no-underline hover:text-ink-invert" to="/">
          ← Dashboard
        </Link>
        <span>
          <span className="text-ink-3">~/</span>
          <span className="text-accent">account</span>
          <span className="text-ink-3 animate-pulse"> _</span>
        </span>
      </header>

      {username && (
        <p className="font-mono text-[12px] text-ink-2 mb-6">
          Logged in as <span className="text-ink-invert">{username}</span>
          {admin && <span className="text-ink-3"> · admin</span>}
        </p>
      )}

      <nav aria-label="Account sections" className="flex flex-wrap border-b border-rule mb-6">
        {SECTIONS.map((s) => (
          <NavLink key={s.to} to={s.to} end={s.end} className={({ isActive }) => `${tabClass(isActive)} no-underline`}>
            {s.label}
          </NavLink>
        ))}
      </nav>

      <Outlet context={{ username, admin } satisfies AccountOutletContext} />
    </div>
  );
}
