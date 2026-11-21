import { expect, it } from 'vitest';
import { createApiToken } from './auth.ts';
import { setValue } from './store.ts';
import { loggedIn } from './test/session.ts';

it('lists only the languages with an old edit, to the session only', async () => {
  const { app, userId, call } = await loggedIn();
  expect(await (await call('GET', '/api/profile-overrides')).json()).toEqual({});
  setValue(userId, 'profile-override-de', JSON.stringify({ name: 'Sam', role: 'Entwickler' }));
  expect(await (await call('GET', '/api/profile-overrides')).json()).toEqual({
    de: { name: 'Sam', role: 'Entwickler' },
  });

  const token = createApiToken(userId, 'overrides-test', 'full');
  if (!token.ok) throw new Error(token.error);
  const byToken = await app.request('/api/profile-overrides', { headers: { authorization: `Bearer ${token.token}` } });
  expect(byToken.status).toBe(401);
});
