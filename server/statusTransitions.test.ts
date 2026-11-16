import './test/env.ts';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { ApplicationConfig } from '../src/types.ts';
import { todayIso } from '../src/utils/date.ts';
import { refusedStorageKeys } from './statusHistory.ts';
import { getJson, KEYS, setJson, setValue } from './store.ts';
import { createTestUser, testApp } from './test/testApp.ts';

type App = ReturnType<typeof testApp>;
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- test responses are checked by assertions
type Json = Record<string, any>;
const json = (method: string, body?: unknown) => ({
  method,
  headers: { 'content-type': 'application/json' },
  ...(body !== undefined && { body: JSON.stringify(body) }),
});

function setup(apps: Partial<ApplicationConfig>[] = [{ id: 'acme', company: 'Acme', role: 'Dev', status: 'drafting', language: 'de' }]) {
  const user = createTestUser();
  setJson(user.id, KEYS.localApps, apps);
  return { user, app: testApp(user) };
}

const step = (app: App, id: string, body: unknown) => app.request(`/api/v1/applications/${id}/transitions`, json('POST', body));
const get = async (app: App, id = 'acme') => (await (await app.request(`/api/v1/applications/${id}`)).json()) as Json;

test('an application without a history reads its old status and dates', async () => {
  const { user, app } = setup([{ id: 'acme', company: 'Acme', role: 'Dev', status: 'drafting', language: 'de' }]);
  setValue(user.id, KEYS.status('acme'), 'rejected');
  setJson(user.id, KEYS.appConfig('acme'), { id: 'acme', company: 'Acme', role: 'Dev', language: 'de', appliedDate: '01.10.2026' });
  const body = await get(app);
  assert.equal(body.status, 'rejected');
  assert.equal(body.appliedDate, '01.10.2026');
  assert.deepEqual(body.statusHistory.map((t: { to: string }) => t.to), ['drafting', 'sent', 'rejected']);
});

test('a transition is recorded with its date and drives status and dates', async () => {
  const { user, app } = setup();
  const res = await step(app, 'acme', { to: 'sent', date: '2026-11-10' });
  assert.equal(res.status, 200);
  const body = await res.json() as Json;
  assert.equal(body.status, 'sent');
  assert.equal(body.appliedDate, '10.11.2026');
  const stored = getJson<{ to: string; date: string }[]>(user.id, KEYS.statusHistory('acme'))!;
  assert.deepEqual(stored.map((t) => [t.to, t.date]), [['drafting', null], ['sent', '2026-11-10']]);
});

test('the date defaults to today', async () => {
  const { app } = setup();
  const body = await (await step(app, 'acme', { to: 'ready' })).json() as Json;
  assert.equal(body.statusHistory.at(-1).date, todayIso());
});

test('a disallowed transition is refused with the allowed ones', async () => {
  const { app } = setup();
  const res = await step(app, 'acme', { to: 'accepted' });
  assert.equal(res.status, 409);
  const body = await res.json() as Json;
  assert.equal(body.from, 'drafting');
  assert.deepEqual(body.allowed, ['ready', 'sent', 'withdrawn']);
  assert.equal((await get(app)).status, 'drafting');
});

test('a stale tab is refused instead of stepping from another state', async () => {
  const { app } = setup();
  await step(app, 'acme', { to: 'sent', expected: 'drafting' });
  const res = await step(app, 'acme', { to: 'ready', expected: 'drafting' });
  assert.equal(res.status, 409);
  assert.equal((await res.json() as Json).from, 'sent');
});

test('an application the server does not know starts from the expected status', async () => {
  const { user, app } = setup([]);
  const res = await step(app, 'bundled', { to: 'interview', expected: 'sent' });
  assert.equal(res.status, 200);
  const stored = getJson<{ to: string }[]>(user.id, KEYS.statusHistory('bundled'))!;
  assert.deepEqual(stored.map((t) => t.to), ['drafting', 'sent', 'interview']);
  assert.equal((await step(app, 'unknown', { to: 'sent' })).status, 404);
});

test('undo goes back step by step but not past the first one', async () => {
  const { app } = setup();
  await step(app, 'acme', { to: 'sent', date: '2026-11-10' });
  const undo = () => app.request('/api/v1/applications/acme/transitions/last', { method: 'DELETE' });
  const first = await undo();
  assert.equal(first.status, 200);
  assert.equal((await first.json() as Json).status, 'drafting');
  const refused = await undo();
  assert.equal(refused.status, 409);
  assert.match((await refused.json() as Json).error, /nothing to undo/);
});

test('the date of a step can be corrected', async () => {
  const { app } = setup();
  await step(app, 'acme', { to: 'sent', date: '2026-11-10' });
  const res = await app.request('/api/v1/applications/acme/transitions/1', json('PATCH', { date: '2026-11-05' }));
  assert.equal(res.status, 200);
  assert.equal((await res.json() as Json).appliedDate, '05.11.2026');
  assert.equal((await app.request('/api/v1/applications/acme/transitions/1', json('PATCH', { date: '5.11.' }))).status, 400);
  assert.equal((await app.request('/api/v1/applications/acme/transitions/0', json('PATCH', { date: '2026-11-05' }))).status, 400);
});

test('a sent application without an answer for 30 days reads as ghosted', async () => {
  const { app } = setup();
  await step(app, 'acme', { to: 'sent', date: '2020-01-01' });
  assert.equal((await get(app)).status, 'ghosted');
  const late = await step(app, 'acme', { to: 'interview', expected: 'ghosted' });
  assert.equal(late.status, 200);
  assert.equal((await late.json() as Json).status, 'interview');
});

test('applications in the trash refuse transitions', async () => {
  const { app } = setup([{ id: 'acme', company: 'Acme', role: 'Dev', status: 'drafting', deletedAt: new Date().toISOString() }]);
  assert.equal((await step(app, 'acme', { to: 'sent' })).status, 409);
});

test('PATCH refuses status and date fields and points to the transitions', async () => {
  const { app } = setup();
  for (const body of [{ status: 'sent' }, { appliedDate: '01.10.2026' }]) {
    const res = await app.request('/api/v1/applications/acme', json('PATCH', body));
    assert.equal(res.status, 400);
    assert.match((await res.json() as Json).details[0], /transitions/);
  }
  assert.equal((await app.request('/api/v1/applications/acme', json('PATCH', { role: 'Backend' }))).status, 200);
});

test('POST starts a draft with a history and refuses dates', async () => {
  const { user, app } = setup([]);
  const created = await app.request('/api/v1/applications', json('POST', { company: 'Beta', role: 'Dev' }));
  assert.equal(created.status, 201);
  const body = await created.json() as Json;
  assert.equal(body.status, 'drafting');
  assert.ok(getJson(user.id, KEYS.statusHistory(body.id)));
  const dated = await app.request('/api/v1/applications', json('POST', { company: 'Gamma', role: 'Dev', appliedDate: '01.10.2026' }));
  assert.equal(dated.status, 400);
});

test('raw storage writes may not set status keys', () => {
  assert.deepEqual(refusedStorageKeys(['app-config-a', 'status-a', 'status-history-a', 'local-apps']), ['status-a', 'status-history-a']);
});
