import { describe, expect, it, vi } from 'vitest';
import { createApp } from './app.ts';
import { createApiToken, hashPassword, type TokenScope } from './auth.ts';
import { db } from './db.ts';

// Through the whole app, as production serves it: these tests cover what
// testApp() skips on purpose (login, session cookie, CSRF, token scopes).
const app = createApp({ staticDir: './does-not-exist' });
const PASSWORD = 'correct horse battery';
const json = { 'content-type': 'application/json' };
// What a browser sends with a POST or DELETE from the app's own page.
const sameOrigin = { origin: 'http://localhost' };

let counter = 0;
async function createUser() {
  const username = `app-user-${++counter}`;
  const { lastInsertRowid } = db
    .prepare('INSERT INTO users (username, password_hash) VALUES (?, ?)')
    .run(username, await hashPassword(PASSWORD));
  return { id: Number(lastInsertRowid), username };
}

const login = (username: string, password = PASSWORD) =>
  app.request('/api/login', { method: 'POST', headers: json, body: JSON.stringify({ username, password }) });

/** Logs in and returns the Cookie header the browser would send from now on. */
async function sessionCookie(username: string): Promise<string> {
  const res = await login(username);
  expect(res.status).toBe(200);
  const cookie = res.headers.get('set-cookie') ?? '';
  expect(cookie).toMatch(/^session=/);
  return cookie.split(';')[0];
}

function tokenFor(userId: number, scope: TokenScope): string {
  const created = createApiToken(userId, `token-${++counter}`, scope);
  if (!created.ok) throw new Error(created.error);
  return created.token;
}

describe('session login', () => {
  it('answers the health check without a login', async () => {
    expect(await (await app.request('/api/health')).json()).toEqual({ ok: true });
  });

  it('refuses a wrong password and needs a session for /api/me', async () => {
    const user = await createUser();
    expect((await login(user.username, 'wrong password')).status).toBe(401);
    expect((await app.request('/api/me')).status).toBe(401);
  });

  it("logs a failed login with the request's ID, so it lines up with the access log", async () => {
    const user = await createUser();
    const lines: string[] = [];
    vi.spyOn(process.stderr, 'write').mockImplementation((chunk) => (lines.push(String(chunk)), true));
    try {
      await app.request('/api/login', {
        method: 'POST',
        headers: { ...json, 'x-request-id': 'trace-login-1' },
        body: JSON.stringify({ username: user.username, password: 'wrong password' }),
      });
    } finally {
      vi.restoreAllMocks();
    }
    const failed = lines.find((line) => line.includes('msg="Login failed"'));
    expect(failed).toContain(`user=${user.username}`);
    expect(failed).toContain('rid=trace-login-1');
    expect(lines.find((line) => line.includes('msg=request'))).toContain('rid=trace-login-1');
  });

  it('logs in with a cookie that works for /api/me, /api/data and /api/v1', async () => {
    const user = await createUser();
    const cookie = await sessionCookie(user.username);
    const me = await app.request('/api/me', { headers: { cookie } });
    expect(await me.json()).toMatchObject({ username: user.username, admin: false });
    expect((await app.request('/api/data', { headers: { cookie } })).status).toBe(200);
    expect((await app.request('/api/v1/me', { headers: { cookie } })).status).toBe(200);
  });

  it('ends the session on logout', async () => {
    const user = await createUser();
    const cookie = await sessionCookie(user.username);
    expect((await app.request('/api/logout', { method: 'POST', headers: { cookie, ...sameOrigin } })).status).toBe(204);
    expect((await app.request('/api/me', { headers: { cookie } })).status).toBe(401);
  });

  it('keeps the token routes behind the session too', async () => {
    expect((await app.request('/api/tokens')).status).toBe(401);
    expect((await app.request('/api/tokens/x', { method: 'DELETE', headers: sameOrigin })).status).toBe(401);
  });
});

describe('CSRF', () => {
  it('refuses a cookie-authenticated form post from another site', async () => {
    const user = await createUser();
    const cookie = await sessionCookie(user.username);
    const res = await app.request('/api/data', {
      method: 'PUT',
      headers: { cookie, origin: 'https://evil.example', 'content-type': 'text/plain' },
      body: JSON.stringify({ set: { x: 'y' } }),
    });
    expect(res.status).toBe(403);
  });
});

describe('API tokens', () => {
  it('authenticates /api/v1 with a bearer token, and rejects an unknown one', async () => {
    const user = await createUser();
    const token = tokenFor(user.id, 'full');
    const me = await app.request('/api/v1/me', { headers: { authorization: `Bearer ${token}` } });
    expect(await me.json()).toMatchObject({ username: user.username });
    expect((await app.request('/api/v1/me', { headers: { authorization: 'Bearer nope' } })).status).toBe(401);
  });

  it('limits a scoped token to its endpoints', async () => {
    const user = await createUser();
    const authorization = `Bearer ${tokenFor(user.id, 'job-leads:ingest')}`;
    expect((await app.request('/api/v1/applications', { headers: { authorization } })).status).toBe(403);
    const posted = await app.request('/api/v1/job-leads', {
      method: 'POST',
      headers: { ...json, authorization },
      body: JSON.stringify({
        leads: [{ source: 'linkedin', externalId: '1', title: 'Dev', url: 'https://example.com/1' }],
      }),
    });
    expect(posted.status).toBe(201);
  });

  it('rotates through the session: the new secret works, the old one stops at once', async () => {
    const user = await createUser();
    const cookie = await sessionCookie(user.username);
    const old = tokenFor(user.id, 'full');
    const label = `token-${counter}`; // the name tokenFor() just gave it
    // A token can't rotate tokens, not even itself.
    const byToken = await app.request(`/api/tokens/${label}/rotate`, {
      method: 'POST',
      headers: { authorization: `Bearer ${old}`, ...sameOrigin },
    });
    expect(byToken.status).toBe(401);

    const res = await app.request(`/api/tokens/${label}/rotate`, {
      method: 'POST',
      headers: { cookie, ...sameOrigin },
    });
    expect(res.status).toBe(200);
    const { token } = (await res.json()) as { token: string };
    expect((await app.request('/api/v1/me', { headers: { authorization: `Bearer ${token}` } })).status).toBe(200);
    expect((await app.request('/api/v1/me', { headers: { authorization: `Bearer ${old}` } })).status).toBe(401);
    const missing = await app.request('/api/tokens/nope/rotate', {
      method: 'POST',
      headers: { cookie, ...sameOrigin },
    });
    expect(missing.status).toBe(404);
  });

  it('is not accepted outside /api/v1', async () => {
    const user = await createUser();
    const authorization = `Bearer ${tokenFor(user.id, 'full')}`;
    expect((await app.request('/api/data', { headers: { authorization } })).status).toBe(401);
    expect((await app.request('/api/tokens', { headers: { authorization } })).status).toBe(401);
  });
});

it('answers unknown API paths with a JSON 404', async () => {
  const res = await app.request('/api/nope');
  expect(res.status).toBe(404);
  expect(await res.json()).toEqual({ error: 'Not found.' });
});
