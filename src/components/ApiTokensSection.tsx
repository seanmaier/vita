import { useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import { useOutletContext } from 'react-router-dom';
import {
  createApiToken,
  fetchApiTokens,
  revokeApiToken,
  rotateApiToken,
  TOKEN_SCOPE_INFO,
  tokenScopesFor,
  type ApiToken,
  type UserTokenScope,
} from '../utils/api';
import { hintText, nafInput, nafLabel, nafRemoveBtn, primaryButton } from '../styles/formStyles';
import { TokenListSkeleton } from './Skeleton';
import type { AccountOutletContext } from '../pages/account/AccountLayout';

const hint = hintText;

// SQLite's datetime('now') is UTC without a zone marker.
function formatTimestamp(value: string | null): string {
  if (!value) return 'never';
  const date = new Date(`${value.replace(' ', 'T')}Z`);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}

/** Lets a user create, rotate and revoke the API tokens scripts and assistants use to call /api/v1. */
export function ApiTokensSection() {
  // Admins also get the worker scopes; the server enforces the same rule.
  const { admin } = useOutletContext<AccountOutletContext>();
  const scopes = tokenScopesFor(admin);
  const [tokens, setTokens] = useState<ApiToken[] | null>(null);
  const [name, setName] = useState('');
  const [scope, setScope] = useState<UserTokenScope>('full');
  const [created, setCreated] = useState<{ name: string; token: string; rotated?: boolean } | null>(null);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = () =>
    fetchApiTokens()
      .then(setTokens)
      .catch((e) => setError(e instanceof Error ? e.message : 'Loading API tokens failed.'));

  useEffect(() => {
    void load();
  }, []);

  const create = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setCopied(false);
    try {
      const token = await createApiToken(name, scope);
      setCreated({ name: name.trim(), token });
      setName('');
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Creating the token failed.');
    } finally {
      setBusy(false);
    }
  };

  const revoke = async (tokenName: string) => {
    if (!confirm(`Revoke the token "${tokenName}"? Anything using it stops working immediately.`)) return;
    setError(null);
    try {
      await revokeApiToken(tokenName);
      if (created?.name === tokenName) setCreated(null);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Revoking the token failed.');
    }
  };

  const rotate = async (tokenName: string) => {
    if (
      !confirm(
        `Rotate the token "${tokenName}"? The current value stops working immediately; you'll get a new one to copy.`,
      )
    ) {
      return;
    }
    setError(null);
    setCopied(false);
    try {
      const token = await rotateApiToken(tokenName);
      setCreated({ name: tokenName, token, rotated: true });
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Rotating the token failed.');
    }
  };

  const copy = async () => {
    if (!created) return;
    await navigator.clipboard.writeText(created.token);
    setCopied(true);
  };

  return (
    <section className="max-w-[560px] flex flex-col gap-4">
      <span className={nafLabel}>API tokens</span>
      <p className={hint}>
        Let scripts and AI assistants read and edit your applications through <code>/api/v1</code>, without your
        password. A token can't log in, change your password or manage tokens.
      </p>

      {!tokens && !error && <TokenListSkeleton />}
      {tokens && tokens.length > 0 && (
        <ul className="flex flex-col gap-2 list-none p-0 m-0">
          {tokens.map((t) => (
            <li
              key={t.name}
              className="flex items-center justify-between gap-3 border border-[color:var(--rule)] rounded-[5px] px-3 py-2"
            >
              <div className="min-w-0">
                <div className="text-[13px] text-[color:var(--ink-invert)] truncate">
                  {t.name}
                  <span className={`${hint} ml-2`}>{TOKEN_SCOPE_INFO[t.scope]?.label ?? t.scope}</span>
                </div>
                {TOKEN_SCOPE_INFO[t.scope] && <div className={hint}>{TOKEN_SCOPE_INFO[t.scope].description}</div>}
                <div className={hint}>
                  created {formatTimestamp(t.created_at)} · last used {formatTimestamp(t.last_used_at)}
                </div>
              </div>
              <div className="flex gap-2 shrink-0">
                <button className={nafRemoveBtn} type="button" onClick={() => void rotate(t.name)}>
                  rotate
                </button>
                <button className={nafRemoveBtn} type="button" onClick={() => void revoke(t.name)}>
                  revoke
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
      {tokens && tokens.length === 0 && <p className={hint}>No tokens yet.</p>}

      {created && (
        <div className="flex flex-col gap-2 border-[1.5px] border-[color:var(--accent)] rounded-[5px] p-3">
          <span className="text-[12px] text-[color:var(--ink-invert)]">
            Token "{created.name}" {created.rotated ? 'rotated' : 'created'}. Copy it now: it won't be shown again.
          </span>
          <code className="[font-family:var(--font-mono)] text-[11.5px] break-all text-[color:var(--ink-2)] select-all">
            {created.token}
          </code>
          <button className={primaryButton} type="button" onClick={() => void copy()}>
            {copied ? 'copied' : 'copy token'}
          </button>
        </div>
      )}

      <form className="flex flex-col sm:flex-row gap-2 sm:items-center" onSubmit={create}>
        <input
          className={nafInput}
          placeholder="Name, e.g. claude-laptop"
          aria-label="Token name"
          required
          maxLength={64}
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
        <select
          className={nafInput}
          aria-label="Scope"
          value={scope}
          onChange={(e) => {
            const next = e.target.value;
            const match = scopes.find((s) => s === next);
            if (match) setScope(match);
          }}
        >
          {scopes.map((s) => (
            <option key={s} value={s}>
              {TOKEN_SCOPE_INFO[s].label}
            </option>
          ))}
        </select>
        <button className={`${primaryButton} shrink-0`} type="submit" disabled={busy}>
          {busy ? 'creating…' : 'create token'}
        </button>
      </form>
      <p className={hint}>{TOKEN_SCOPE_INFO[scope].description}</p>

      {error && <p className="text-[12px] text-[color:var(--status-rejected)]">{error}</p>}
    </section>
  );
}
