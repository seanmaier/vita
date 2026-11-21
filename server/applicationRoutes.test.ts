import { describe, expect, it } from 'vitest';
import { createApiToken } from './auth.ts';
import { db } from './db.ts';
import { loggedIn } from './test/session.ts';

type Stored = {
  id: string;
  config: Record<string, unknown> | null;
  savedEdits: Record<string, unknown> | null;
  statusHistory: { to: string }[] | null;
};

const acme = { id: 'acme', company: 'Acme', role: 'Dev', status: 'drafting' };

/** A logged-in user; `call` goes to /api/applications, `raw` anywhere. */
async function session() {
  const s = await loggedIn();
  const call = (method: string, path: string, body?: unknown) => s.call(method, `/api/applications${path}`, body);
  const all = async (res: Response) => (await res.json()) as Stored[];
  return { ...s, raw: s.call, call, all };
}

describe('app application routes', () => {
  it('add an application with a history seeded from its status', async () => {
    const { call, all } = await session();
    expect(await all(await call('GET', ''))).toEqual([]);
    const [stored] = await all(await call('PUT', '/acme', acme));
    expect(stored).toMatchObject({ id: 'acme', config: acme, savedEdits: null });
    expect(stored.statusHistory?.map((t) => t.to)).toEqual(['drafting']);
    expect((await call('PUT', '/acme', { ...acme, id: 'other' })).status).toBe(400);
  });

  it('save edits with a message for the version history, and reset them', async () => {
    const { call, all, raw } = await session();
    await call('PUT', '/acme', acme);
    const [withEdits] = await all(
      await call('PUT', '/acme/saved-edits', { config: { ...acme, role: 'Senior Dev' }, message: 'Promoted' }),
    );
    expect(withEdits.savedEdits).toMatchObject({ role: 'Senior Dev' });
    const versions = (await (await raw('GET', '/api/v1/applications/acme/versions')).json()) as {
      message: string | null;
    }[];
    expect(versions[0].message).toBe('Promoted');

    const [reset] = await all(await call('DELETE', '/acme/saved-edits'));
    expect(reset.savedEdits).toBeNull();
  });

  it('trash, restore and delete for good with edits, history and versions', async () => {
    const { call, all, userId } = await session();
    await call('PUT', '/acme', acme);
    await call('PUT', '/acme/saved-edits', { config: { ...acme, role: 'Lead' } });
    const [trashed] = await all(await call('POST', '/acme/trash'));
    expect(trashed.config?.deletedAt).toBeTruthy();
    const [restored] = await all(await call('POST', '/acme/restore'));
    expect(restored.config).not.toHaveProperty('deletedAt');

    expect(await all(await call('DELETE', '/acme'))).toEqual([]);
    const versions = db
      .prepare("SELECT COUNT(*) AS n FROM app_versions WHERE user_id = ? AND app_id = 'acme'")
      .get(userId);
    expect(versions).toEqual({ n: 0 });
    expect((await call('DELETE', '/acme')).status).toBe(404);
    expect((await call('POST', '/nope/trash')).status).toBe(404);
  });

  it('list an application bundled with the app once it has saved edits', async () => {
    const { call, all } = await session();
    const [bundled] = await all(
      await call('PUT', '/from-file/saved-edits', { config: { id: 'from-file', company: 'F' } }),
    );
    expect(bundled).toMatchObject({ id: 'from-file', config: null, savedEdits: { company: 'F' }, statusHistory: null });
  });

  it('are closed to API tokens', async () => {
    const { app, userId } = await session();
    const token = createApiToken(userId, 'apps-test', 'full');
    if (!token.ok) throw new Error(token.error);
    expect(
      (await app.request('/api/applications', { headers: { authorization: `Bearer ${token.token}` } })).status,
    ).toBe(401);
  });
});
