import './test/env.ts';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createTestUser, testApp } from './test/testApp.ts';

type App = ReturnType<typeof testApp>;
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- test responses are checked by assertions
type Json = Record<string, any>;
const json = (method: string, body: unknown) => ({ method, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
const fit = { score: 80, recommendation: 'apply', reason: 'Backend, C#, hybrid in Hamburg.', evaluatedAt: '2026-11-16T10:00:00.000Z' };

const create = (app: App, body: unknown) => app.request('/api/v1/applications', json('POST', body));

test('a checked job is created as evaluated with its fit', async () => {
  const app = testApp(createTestUser());
  const res = await create(app, { company: 'Acme', role: 'Dev', status: 'evaluated', fit, url: 'https://example.org/job/1' });
  assert.equal(res.status, 201);
  const body = (await res.json()) as Json;
  assert.equal(body.status, 'evaluated');
  assert.deepEqual(body.fit, fit);
  assert.deepEqual(body.statusHistory.map((t: Json) => t.to), ['evaluated']);
});

test('only drafting or evaluated can be the starting status', async () => {
  const app = testApp(createTestUser());
  const res = await create(app, { company: 'Acme', role: 'Dev', status: 'sent' });
  assert.equal(res.status, 400);
  assert.equal(((await (await create(app, { company: 'Beta', role: 'Dev' })).json()) as Json).status, 'drafting');
});

test('an evaluated job is skipped or turned into a draft', async () => {
  const app = testApp(createTestUser());
  await create(app, { id: 'skip-me', company: 'Skip', role: 'Dev', status: 'evaluated', fit });
  await create(app, { id: 'apply-me', company: 'Apply', role: 'Dev', status: 'evaluated', fit });
  const skip = await app.request('/api/v1/applications/skip-me/transitions', json('POST', { to: 'skipped' }));
  assert.equal(((await skip.json()) as Json).status, 'skipped');
  const draft = await app.request('/api/v1/applications/apply-me/transitions', json('POST', { to: 'drafting' }));
  assert.equal(((await draft.json()) as Json).status, 'drafting');
  const wrong = await app.request('/api/v1/applications/skip-me/transitions', json('POST', { to: 'drafting' }));
  assert.equal(wrong.status, 409);
});

test('a re-check updates the fit with PATCH', async () => {
  const app = testApp(createTestUser());
  await create(app, { id: 'acme', company: 'Acme', role: 'Dev', status: 'evaluated', fit });
  const updated = { ...fit, score: 65, recommendation: 'apply-if', reason: 'Only if hybrid.' };
  const res = await app.request('/api/v1/applications/acme', json('PATCH', { fit: updated }));
  assert.equal(res.status, 200);
  assert.deepEqual(((await res.json()) as Json).fit, updated);
  const bad = await app.request('/api/v1/applications/acme', json('PATCH', { fit: { ...fit, score: 140 } }));
  assert.equal(bad.status, 400);
});
