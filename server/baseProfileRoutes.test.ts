import { beforeEach, describe, expect, it } from 'vitest';
import { createApiToken } from './auth.ts';
import { loggedIn } from './test/session.ts';

// The app's own base profile routes, through the real app with a session.
const profile = (id: string, name = id) => ({ id, name, language: 'en', profile: { name: '' } });

type Session = Awaited<ReturnType<typeof loggedIn>>;
let app: Session['app'];
let userId = 0;
let session: Session['call'];

beforeEach(async () => {
  ({ app, userId, call: session } = await loggedIn());
});

const call = (method: string, path: string, body?: unknown) => session(method, `/api/base-profiles${path}`, body);
const ids = async (res: Response) => ((await res.json()) as { id: string }[]).map((p) => p.id);

describe('app base profile routes', () => {
  it('start without a list, and only the first seed is stored', async () => {
    expect(await (await call('GET', '')).json()).toBeNull();
    expect(await ids(await call('POST', '/seed', [profile('default-en')]))).toEqual(['default-en']);
    expect(await ids(await call('POST', '/seed', [profile('other')]))).toEqual(['default-en']);
  });

  it('save a draft and replace a profile in place', async () => {
    await call('POST', '/seed', [profile('a'), profile('b')]);
    // A draft without a person's name, which /api/v1 would refuse.
    expect(await ids(await call('PUT', '/new', profile('new', '')))).toEqual(['a', 'b', 'new']);
    const replaced = (await (await call('PUT', '/a', profile('a', 'Renamed'))).json()) as {
      id: string;
      name: string;
    }[];
    expect(replaced.map((p) => [p.id, p.name])).toEqual([
      ['a', 'Renamed'],
      ['b', 'b'],
      ['new', ''],
    ]);
    expect((await call('PUT', '/a', profile('b'))).status).toBe(400);
  });

  it('trash, restore and delete for good', async () => {
    await call('POST', '/seed', [profile('a'), profile('b')]);
    const trashed = (await (await call('POST', '/a/trash')).json()) as { id: string; deletedAt?: string }[];
    expect(trashed[0].deletedAt).toBeTruthy();
    const restored = (await (await call('POST', '/a/restore')).json()) as { deletedAt?: string }[];
    expect(restored[0]).not.toHaveProperty('deletedAt');
    expect(await ids(await call('DELETE', '/a'))).toEqual(['b']);
    expect((await call('DELETE', '/a')).status).toBe(404);
  });

  it('are closed to API tokens', async () => {
    const created = createApiToken(userId, 'routes-test', 'full');
    if (!created.ok) throw new Error(created.error);
    const res = await app.request('/api/base-profiles', { headers: { authorization: `Bearer ${created.token}` } });
    expect(res.status).toBe(401);
  });
});
