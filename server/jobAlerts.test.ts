import './test/env.ts';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createTestUser, testApp } from './test/testApp.ts';

type App = ReturnType<typeof testApp>;
const json = { 'content-type': 'application/json' };
const ADDRESS = /^jobs-[a-z0-9]{10}@alerts\.example\.org$/;
const get = (app: App, path = '') => app.request(`/api/v1/job-alerts${path}`);
const generate = (app: App) => app.request('/api/v1/job-alerts/address', { method: 'POST' });
const put = (app: App, body: unknown) =>
  app.request('/api/v1/job-alerts', { method: 'PUT', headers: json, body: JSON.stringify(body) });

test('a user without an address gets nulls', async () => {
  const res = await get(testApp(createTestUser()));
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { available: true, address: null, forwardingFrom: null });
});

test('generating an address creates a random one, and again replaces it', async () => {
  const app = testApp(createTestUser());
  const first = (await (await generate(app)).json()) as { address: string };
  assert.match(first.address, ADDRESS);
  const second = (await (await generate(app)).json()) as { address: string };
  assert.match(second.address, ADDRESS);
  assert.notEqual(first.address, second.address);
  assert.deepEqual(await (await get(app)).json(), { available: true, address: second.address, forwardingFrom: null });
});

test('forwardingFrom needs an address first, must look like one, and is stored trimmed', async () => {
  const app = testApp(createTestUser());
  assert.equal((await put(app, { forwardingFrom: 'me@example.org' })).status, 404);
  await generate(app);
  assert.equal((await put(app, { forwardingFrom: 'kein-mail' })).status, 400);
  assert.equal((await put(app, { forwardingFrom: 5 })).status, 400);
  const ok = await put(app, { forwardingFrom: '  Me@Example.org ' });
  assert.equal(ok.status, 200);
  assert.equal(((await ok.json()) as { forwardingFrom: string }).forwardingFrom, 'Me@Example.org');
  const cleared = await put(app, { forwardingFrom: null });
  assert.equal(((await cleared.json()) as { forwardingFrom: null }).forwardingFrom, null);
});

test("another user does not see someone's address", async () => {
  const a = testApp(createTestUser());
  const b = testApp(createTestUser());
  await generate(a);
  assert.deepEqual(await (await get(b)).json(), { available: true, address: null, forwardingFrom: null });
});

test('events validate their limit', async () => {
  const app = testApp(createTestUser());
  assert.equal((await get(app, '/events?limit=0')).status, 400);
  assert.equal((await get(app, '/events?limit=51')).status, 400);
  assert.deepEqual(await (await get(app, '/events?limit=5')).json(), []);
});

test('without INBOUND_DOMAIN job alerts are off and no address can be created', async (t) => {
  const app = testApp(createTestUser());
  assert.equal((await generate(app)).status, 200);
  const saved = process.env.INBOUND_DOMAIN;
  delete process.env.INBOUND_DOMAIN;
  t.after(() => {
    process.env.INBOUND_DOMAIN = saved;
  });
  assert.deepEqual(await (await get(app)).json(), { available: false, address: null, forwardingFrom: null });
  const res = await generate(app);
  assert.equal(res.status, 503);
  assert.match(((await res.json()) as { error: string }).error, /INBOUND_DOMAIN/);
});
