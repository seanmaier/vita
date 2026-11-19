import { expect, onTestFinished, test } from 'vitest';
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
  expect(res.status).toBe(200);
  expect(await res.json()).toEqual({ available: true, address: null, forwardingFrom: null });
});

test('generating an address creates a random one, and again replaces it', async () => {
  const app = testApp(createTestUser());
  const first = (await (await generate(app)).json()) as { address: string };
  expect(first.address).toMatch(ADDRESS);
  const second = (await (await generate(app)).json()) as { address: string };
  expect(second.address).toMatch(ADDRESS);
  expect(first.address).not.toBe(second.address);
  expect(await (await get(app)).json()).toEqual({ available: true, address: second.address, forwardingFrom: null });
});

test('forwardingFrom needs an address first, must look like one, and is stored trimmed', async () => {
  const app = testApp(createTestUser());
  expect((await put(app, { forwardingFrom: 'me@example.org' })).status).toBe(404);
  await generate(app);
  expect((await put(app, { forwardingFrom: 'kein-mail' })).status).toBe(400);
  expect((await put(app, { forwardingFrom: 5 })).status).toBe(400);
  const ok = await put(app, { forwardingFrom: '  Me@Example.org ' });
  expect(ok.status).toBe(200);
  expect(((await ok.json()) as { forwardingFrom: string }).forwardingFrom).toBe('Me@Example.org');
  const cleared = await put(app, { forwardingFrom: null });
  expect(((await cleared.json()) as { forwardingFrom: null }).forwardingFrom).toBe(null);
});

test("another user does not see someone's address", async () => {
  const a = testApp(createTestUser());
  const b = testApp(createTestUser());
  await generate(a);
  expect(await (await get(b)).json()).toEqual({ available: true, address: null, forwardingFrom: null });
});

test('events validate their limit', async () => {
  const app = testApp(createTestUser());
  expect((await get(app, '/events?limit=0')).status).toBe(400);
  expect((await get(app, '/events?limit=51')).status).toBe(400);
  expect(await (await get(app, '/events?limit=5')).json()).toEqual([]);
});

test('without INBOUND_DOMAIN job alerts are off and no address can be created', async () => {
  const app = testApp(createTestUser());
  expect((await generate(app)).status).toBe(200);
  const saved = process.env.INBOUND_DOMAIN;
  delete process.env.INBOUND_DOMAIN;
  onTestFinished(() => {
    process.env.INBOUND_DOMAIN = saved;
  });
  expect(await (await get(app)).json()).toEqual({ available: false, address: null, forwardingFrom: null });
  const res = await generate(app);
  expect(res.status).toBe(503);
  expect(((await res.json()) as { error: string }).error).toMatch(/INBOUND_DOMAIN/);
});
