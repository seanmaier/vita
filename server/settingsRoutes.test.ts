import { describe, expect, it } from 'vitest';
import { createApiToken } from './auth.ts';
import { loggedIn } from './test/session.ts';

describe('app settings routes', () => {
  it('remember that the tour was closed', async () => {
    const { call } = await loggedIn();
    expect(await (await call('GET', '/api/settings')).json()).toEqual({ tourSeen: false });
    expect(await (await call('PUT', '/api/settings/tour-seen')).json()).toEqual({ tourSeen: true });
    expect(await (await call('GET', '/api/settings')).json()).toEqual({ tourSeen: true });
  });

  it('are closed to API tokens', async () => {
    const { app, userId } = await loggedIn();
    const token = createApiToken(userId, 'settings-test', 'full');
    if (!token.ok) throw new Error(token.error);
    const res = await app.request('/api/settings', { headers: { authorization: `Bearer ${token.token}` } });
    expect(res.status).toBe(401);
  });
});
