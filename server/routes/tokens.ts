// Users manage their own API tokens from the account page. These routes take
// the session cookie only: a token must not be able to mint, rotate or revoke tokens.
import { Hono } from 'hono';
import { createApiToken, isAdmin, listApiTokens, parseUserTokenScope, revokeApiToken, rotateApiToken } from '../auth.ts';
import { log } from '../log.ts';
import { requireUser, type SessionEnv } from '../session.ts';

export const tokenRoutes = new Hono<SessionEnv>();

tokenRoutes.use('*', requireUser);

tokenRoutes.get('/', (c) => c.json(listApiTokens(c.get('user').id)));

tokenRoutes.post('/', async (c) => {
  const body: { name?: unknown; scope?: unknown } = await c.req.json().catch(() => ({}));
  const scope = parseUserTokenScope(body.scope, isAdmin(c.get('user').id));
  if (!scope.ok) return c.json({ error: scope.error }, 400);
  const name = typeof body.name === 'string' ? body.name.trim() : '';
  const result = createApiToken(c.get('user').id, name, scope.scope);
  if (!result.ok) return c.json({ error: result.error }, result.status);
  log.info('API token created', { user: c.get('user').username, token: name, scope: scope.scope });
  return c.json({ token: result.token }, 201);
});

tokenRoutes.delete('/:name', (c) => {
  if (!revokeApiToken(c.get('user').id, c.req.param('name'))) return c.json({ error: 'No such token.' }, 404);
  log.info('API token revoked', { user: c.get('user').username, token: c.req.param('name') });
  return c.body(null, 204);
});

tokenRoutes.post('/:name/rotate', (c) => {
  const name = c.req.param('name');
  const result = rotateApiToken(c.get('user').id, name);
  if (!result.ok) return c.json({ error: result.error }, result.status);
  log.info('API token rotated', { user: c.get('user').username, token: name });
  return c.json({ token: result.token });
});
