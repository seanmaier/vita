// The session cookie and the middleware that decides who a request is from.
import type { Context } from 'hono';
import { getCookie, setCookie } from 'hono/cookie';
import { createMiddleware } from 'hono/factory';
import { createSession, getApiToken, getSessionUser, SESSION_TTL_MS, tokenAllows, type User } from './auth.ts';
import type { V1Env } from './http.ts';

export const SESSION_COOKIE = 'session';

// On in production (behind the HTTPS reverse proxy), off for local http dev.
const SECURE_COOKIE = process.env.COOKIE_SECURE
  ? process.env.COOKIE_SECURE === 'true'
  : process.env.NODE_ENV === 'production';

/** Hono env of routes behind requireUser. */
export type SessionEnv = { Variables: { user: User } };

export function startSession(c: Context, userId: number) {
  setCookie(c, SESSION_COOKIE, createSession(userId), {
    httpOnly: true,
    secure: SECURE_COOKIE,
    sameSite: 'Lax',
    path: '/',
    maxAge: SESSION_TTL_MS / 1000,
  });
}

export const requireUser = createMiddleware<SessionEnv>(async (c, next) => {
  const token = getCookie(c, SESSION_COOKIE);
  const user = token ? getSessionUser(token) : null;
  if (!user) return c.json({ error: 'Not logged in.' }, 401);
  c.set('user', user);
  await next();
});

// /api/v1 also accepts `Authorization: Bearer <api token>`, so scripts can
// call it without a password. Tokens are deliberately not accepted on the
// other routes: they can't change the password or overwrite raw storage.
export const requireUserOrToken = createMiddleware<V1Env>(async (c, next) => {
  const auth = c.req.header('authorization');
  if (auth !== undefined) {
    const match = /^Bearer\s+(\S+)$/i.exec(auth);
    const found = match ? getApiToken(match[1]) : null;
    if (!found) return c.json({ error: 'Invalid API token.' }, 401);
    if (!tokenAllows(found.scope, c.req.method, c.req.path)) {
      return c.json({ error: 'This token may not call this endpoint.' }, 403);
    }
    c.set('user', found.user);
    c.set('tokenScope', found.scope);
    c.set('apiToken', found.tokenName);
    return next();
  }
  return requireUser(c, next);
});
