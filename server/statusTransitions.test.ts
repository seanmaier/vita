import { expect, test } from 'vitest';
import type { ApplicationConfig } from '#shared/types.ts';
import { todayIso } from '#shared/utils/date.ts';
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

function setup(
  apps: Partial<ApplicationConfig>[] = [
    { id: 'acme', company: 'Acme', role: 'Dev', status: 'drafting', language: 'de' },
  ],
) {
  const user = createTestUser();
  setJson(user.id, KEYS.localApps, apps);
  return { user, app: testApp(user) };
}

const step = (app: App, id: string, body: unknown) =>
  app.request(`/api/v1/applications/${id}/transitions`, json('POST', body));
const get = async (app: App, id = 'acme') => (await (await app.request(`/api/v1/applications/${id}`)).json()) as Json;

test('an application without a history reads its old status and dates', async () => {
  const { user, app } = setup([{ id: 'acme', company: 'Acme', role: 'Dev', status: 'drafting', language: 'de' }]);
  setValue(user.id, KEYS.status('acme'), 'rejected');
  setJson(user.id, KEYS.appConfig('acme'), {
    id: 'acme',
    company: 'Acme',
    role: 'Dev',
    language: 'de',
    appliedDate: '01.10.2026',
  });
  const body = await get(app);
  expect(body.status).toBe('rejected');
  expect(body.appliedDate).toBe('01.10.2026');
  expect(body.statusHistory.map((t: { to: string }) => t.to)).toEqual(['drafting', 'sent', 'rejected']);
});

test('a transition is recorded with its date and drives status and dates', async () => {
  const { user, app } = setup();
  const res = await step(app, 'acme', { to: 'sent', date: '2026-11-10' });
  expect(res.status).toBe(200);
  const body = (await res.json()) as Json;
  expect(body.status).toBe('sent');
  expect(body.appliedDate).toBe('10.11.2026');
  const stored = getJson<{ to: string; date: string }[]>(user.id, KEYS.statusHistory('acme'))!;
  expect(stored.map((t) => [t.to, t.date])).toEqual([
    ['drafting', null],
    ['sent', '2026-11-10'],
  ]);
});

test('the date defaults to today', async () => {
  const { app } = setup();
  const body = (await (await step(app, 'acme', { to: 'ready' })).json()) as Json;
  expect(body.statusHistory.at(-1).date).toBe(todayIso());
});

test('a disallowed transition is refused with the allowed ones', async () => {
  const { app } = setup();
  const res = await step(app, 'acme', { to: 'accepted' });
  expect(res.status).toBe(409);
  const body = (await res.json()) as Json;
  expect(body.from).toBe('drafting');
  expect(body.allowed).toEqual(['ready', 'sent', 'withdrawn']);
  expect((await get(app)).status).toBe('drafting');
});

test('a stale tab is refused instead of stepping from another state', async () => {
  const { app } = setup();
  await step(app, 'acme', { to: 'sent', expected: 'drafting' });
  const res = await step(app, 'acme', { to: 'ready', expected: 'drafting' });
  expect(res.status).toBe(409);
  expect(((await res.json()) as Json).from).toBe('sent');
});

test('an application the server does not know starts from the expected status', async () => {
  const { user, app } = setup([]);
  const res = await step(app, 'bundled', { to: 'interview', expected: 'sent' });
  expect(res.status).toBe(200);
  const stored = getJson<{ to: string }[]>(user.id, KEYS.statusHistory('bundled'))!;
  expect(stored.map((t) => t.to)).toEqual(['drafting', 'sent', 'interview']);
  expect((await step(app, 'unknown', { to: 'sent' })).status).toBe(404);
});

test('undo goes back step by step but not past the first one', async () => {
  const { app } = setup();
  await step(app, 'acme', { to: 'sent', date: '2026-11-10' });
  const undo = () => app.request('/api/v1/applications/acme/transitions/last', { method: 'DELETE' });
  const first = await undo();
  expect(first.status).toBe(200);
  expect(((await first.json()) as Json).status).toBe('drafting');
  const refused = await undo();
  expect(refused.status).toBe(409);
  expect(((await refused.json()) as Json).error).toMatch(/nothing to undo/);
});

test('the date of a step can be corrected', async () => {
  const { app } = setup();
  await step(app, 'acme', { to: 'sent', date: '2026-11-10' });
  const res = await app.request('/api/v1/applications/acme/transitions/1', json('PATCH', { date: '2026-11-05' }));
  expect(res.status).toBe(200);
  expect(((await res.json()) as Json).appliedDate).toBe('05.11.2026');
  expect((await app.request('/api/v1/applications/acme/transitions/1', json('PATCH', { date: '5.11.' }))).status).toBe(
    400,
  );
  expect(
    (await app.request('/api/v1/applications/acme/transitions/0', json('PATCH', { date: '2026-11-05' }))).status,
  ).toBe(400);
});

test('a sent application without an answer for 30 days reads as ghosted', async () => {
  const { app } = setup();
  await step(app, 'acme', { to: 'sent', date: '2020-01-01' });
  expect((await get(app)).status).toBe('ghosted');
  const late = await step(app, 'acme', { to: 'interview', expected: 'ghosted' });
  expect(late.status).toBe(200);
  expect(((await late.json()) as Json).status).toBe('interview');
});

test('applications in the trash refuse transitions', async () => {
  const { app } = setup([
    { id: 'acme', company: 'Acme', role: 'Dev', status: 'drafting', deletedAt: new Date().toISOString() },
  ]);
  expect((await step(app, 'acme', { to: 'sent' })).status).toBe(409);
});

test('PATCH refuses status and date fields and points to the transitions', async () => {
  const { app } = setup();
  for (const body of [{ status: 'sent' }, { appliedDate: '01.10.2026' }]) {
    const res = await app.request('/api/v1/applications/acme', json('PATCH', body));
    expect(res.status).toBe(400);
    expect(((await res.json()) as Json).details[0]).toMatch(/transitions/);
  }
  expect((await app.request('/api/v1/applications/acme', json('PATCH', { role: 'Backend' }))).status).toBe(200);
});

test('POST starts a draft with a history and refuses dates', async () => {
  const { user, app } = setup([]);
  const created = await app.request('/api/v1/applications', json('POST', { company: 'Beta', role: 'Dev' }));
  expect(created.status).toBe(201);
  const body = (await created.json()) as Json;
  expect(body.status).toBe('drafting');
  expect(getJson(user.id, KEYS.statusHistory(body.id))).toBeTruthy();
  const dated = await app.request(
    '/api/v1/applications',
    json('POST', { company: 'Gamma', role: 'Dev', appliedDate: '01.10.2026' }),
  );
  expect(dated.status).toBe(400);
});
