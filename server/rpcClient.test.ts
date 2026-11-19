import { hc } from 'hono/client';
import { describe, expect, it } from 'vitest';
import { createApp, type AppType } from './app.ts';
import { hashPassword } from './auth.ts';
import { db } from './db.ts';

// The frontend's typed client (src/utils/apiClient.ts) against the real app:
// proves the URLs, parameters and bodies it builds reach the right routes.
const app = createApp({ staticDir: './does-not-exist' });

async function loggedInClient() {
  const username = `rpc-${crypto.randomUUID().slice(0, 8)}`;
  db.prepare('INSERT INTO users (username, password_hash) VALUES (?, ?)').run(
    username,
    await hashPassword('rpc password 123'),
  );
  let cookie = '';
  const client = hc<AppType>('http://localhost/', {
    fetch: async (input: string | URL | Request, init?: RequestInit) => {
      const headers = new Headers(init?.headers);
      if (cookie) headers.set('cookie', cookie);
      // What the browser adds to the app's own POST/PUT/DELETE requests.
      headers.set('origin', 'http://localhost');
      const res = await app.request(input instanceof Request ? input : String(input), { ...init, headers });
      const setCookie = res.headers.get('set-cookie');
      if (setCookie) cookie = setCookie.split(';')[0];
      return res;
    },
  });
  const res = await client.api.login.$post({ json: { username, password: 'rpc password 123' } });
  expect(res.status).toBe(200);
  return { client, username };
}

describe('typed API client', () => {
  it('reads the session user', async () => {
    const { client, username } = await loggedInClient();
    const res = await client.api.me.$get();
    expect(await res.json()).toMatchObject({ username, admin: false });
  });

  it('creates, lists, rotates and revokes a token whose name needs encoding', async () => {
    const { client } = await loggedInClient();
    expect((await client.api.tokens.$post({ json: { name: 'my laptop/2', scope: 'full' } })).status).toBe(201);
    const listed = await (await client.api.tokens.$get()).json();
    expect(listed.map((t) => t.name)).toEqual(['my laptop/2']);
    const rotated = await client.api.tokens[':name'].rotate.$post({
      param: { name: encodeURIComponent('my laptop/2') },
    });
    expect(await rotated.json()).toMatchObject({ token: expect.any(String) });
    const revoked = await client.api.tokens[':name'].$delete({ param: { name: encodeURIComponent('my laptop/2') } });
    expect(revoked.status).toBe(204);
  });

  it('saves and reads a knowledge document', async () => {
    const { client } = await loggedInClient();
    await client.api.v1.knowledge[':doc'].$put({ param: { doc: 'priorities' }, json: { content: 'Remote first' } });
    const res = await client.api.v1.knowledge[':doc'].$get({ param: { doc: 'priorities' } });
    expect(await res.json()).toEqual({ doc: 'priorities', content: 'Remote first' });
  });

  it('stores data and moves an application through a transition', async () => {
    const { client } = await loggedInClient();
    const app = { id: 'acme gmbh', company: 'Acme GmbH', role: 'Dev', status: 'drafting' };
    const put = await client.api.data.$put({ json: { set: { 'local-apps': JSON.stringify([app]) }, remove: [] } });
    expect(put.status).toBe(204);
    const transitions = client.api.v1.applications[':id'].transitions;
    const sent = await transitions.$post({
      param: { id: encodeURIComponent(app.id) },
      json: { to: 'sent', date: '2026-11-18', expected: 'drafting' },
    });
    expect(sent.status).toBe(200);
    const undone = await transitions.last.$delete({ param: { id: encodeURIComponent(app.id) } });
    expect(undone.status).toBe(200);
  });

  it('lists job leads with a query', async () => {
    const { client } = await loggedInClient();
    const res = await client.api.v1['job-leads'].$get({ query: { limit: '200', status: 'rated' } });
    expect(await res.json()).toEqual([]);
  });
});
