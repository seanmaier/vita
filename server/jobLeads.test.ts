import './test/env.ts';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createTestUser, testApp } from './test/testApp.ts';

type App = ReturnType<typeof testApp>;
const json = { 'content-type': 'application/json' };
const lead = (n: number, extra: Record<string, unknown> = {}) => ({
  source: 'linkedin',
  externalId: `ext-${n}`,
  title: `Job ${n}`,
  url: `https://example.com/jobs/${n}`,
  ...extra,
});
const post = (app: App, body: unknown) =>
  app.request('/api/v1/job-leads', { method: 'POST', headers: json, body: JSON.stringify(body) });
const patch = (app: App, id: number, body: unknown) =>
  app.request(`/api/v1/job-leads/${id}`, { method: 'PATCH', headers: json, body: JSON.stringify(body) });

test('posting leads creates them, and a repeat is all duplicates', async () => {
  const app = testApp(createTestUser());
  const res = await post(app, { leads: [lead(1), lead(2)] });
  assert.equal(res.status, 201);
  assert.deepEqual(await res.json(), { created: 2, duplicates: 0 });
  const again = await post(app, { leads: [lead(1), lead(2)] });
  assert.equal(again.status, 201);
  assert.deepEqual(await again.json(), { created: 0, duplicates: 2 });
});

test('the same externalId with another url is a duplicate', async () => {
  const app = testApp(createTestUser());
  await post(app, { leads: [lead(1)] });
  const res = await post(app, { leads: [lead(1, { url: 'https://example.com/other' })] });
  assert.deepEqual(await res.json(), { created: 0, duplicates: 1 });
});

test('non-https urls are rejected with an indexed detail', async () => {
  const app = testApp(createTestUser());
  for (const url of ['javascript:alert(1)', 'http://x.de']) {
    const res = await post(app, { leads: [lead(1), lead(2), lead(3), lead(4, { url })] });
    assert.equal(res.status, 400);
    const body = (await res.json()) as { details: string[] };
    assert.ok(body.details.some((d) => d.startsWith('leads[3].url')));
  }
});

test('batch size and body shape are validated', async () => {
  const app = testApp(createTestUser());
  assert.equal((await post(app, { leads: Array.from({ length: 101 }, (_, i) => lead(i)) })).status, 400);
  assert.equal((await post(app, { leads: [] })).status, 400);
  assert.equal((await post(app, {})).status, 400);
  assert.equal((await post(app, { leads: 'x' })).status, 400);
  assert.equal((await post(app, { leads: [lead(1)], extra: 1 })).status, 400);
  assert.equal((await post(app, { leads: [lead(1, { bogus: 1 })] })).status, 400);
  assert.equal((await post(app, { leads: [lead(1, { title: '   ' })] })).status, 400);
});

test('blank company and location are stored as null, text is trimmed', async () => {
  const app = testApp(createTestUser());
  await post(app, { leads: [lead(1, { title: '  Dev  ', company: '  ', location: ' Köln ' })] });
  const [row] = (await (await app.request('/api/v1/job-leads')).json()) as Record<string, unknown>[];
  assert.equal(row.title, 'Dev');
  assert.equal(row.company, undefined);
  assert.equal(row.location, 'Köln');
  assert.equal(row.status, 'new');
  assert.equal(row.externalId, 'ext-1');
});

test('GET filters by status, is newest first, and is private', async () => {
  const app = testApp(createTestUser());
  const other = testApp(createTestUser());
  await post(app, { leads: [lead(1), lead(2), lead(3)] });
  await post(other, { leads: [lead(9)] });
  const all = (await (await app.request('/api/v1/job-leads')).json()) as { id: number }[];
  assert.equal(all.length, 3);
  assert.ok(all[0].id > all[1].id && all[1].id > all[2].id);
  await patch(app, all[0].id, { status: 'dismissed' });
  const fresh = (await (await app.request('/api/v1/job-leads?status=new')).json()) as { status: string }[];
  assert.equal(fresh.length, 2);
  assert.ok(fresh.every((l) => l.status === 'new'));
  const limited = (await (await app.request('/api/v1/job-leads?limit=1')).json()) as unknown[];
  assert.equal(limited.length, 1);
});

test('GET rejects a bad status or limit', async () => {
  const app = testApp(createTestUser());
  for (const q of ['status=nope', 'limit=0', 'limit=201', 'limit=abc', 'limit=1.5']) {
    assert.equal((await app.request(`/api/v1/job-leads?${q}`)).status, 400, q);
  }
});

test('PATCH rates a lead and stamps ratedAt', async () => {
  const app = testApp(createTestUser());
  await post(app, { leads: [lead(1)] });
  const [{ id }] = (await (await app.request('/api/v1/job-leads')).json()) as { id: number }[];
  const res = await patch(app, id, { score: 82, verdict: 'Passt', status: 'rated' });
  assert.equal(res.status, 200);
  const updated = (await res.json()) as Record<string, unknown>;
  assert.equal(updated.score, 82);
  assert.equal(updated.verdict, 'Passt');
  assert.equal(updated.status, 'rated');
  assert.equal(typeof updated.ratedAt, 'string');
  const cleared = (await (await patch(app, id, { score: null, applicationId: 'abc' })).json()) as Record<string, unknown>;
  assert.equal(cleared.score, null);
  assert.equal(cleared.ratedAt, null);
  assert.equal(cleared.applicationId, 'abc');
});

test('PATCH validates input and scopes to the owner', async () => {
  const app = testApp(createTestUser());
  const other = testApp(createTestUser());
  await post(app, { leads: [lead(1)] });
  const [{ id }] = (await (await app.request('/api/v1/job-leads')).json()) as { id: number }[];
  assert.equal((await patch(app, id, { score: 101 })).status, 400);
  assert.equal((await patch(app, id, { score: 1.5 })).status, 400);
  assert.equal((await patch(app, id, { status: 'bogus' })).status, 400);
  assert.equal((await patch(app, id, { verdict: 'x'.repeat(1001) })).status, 400);
  assert.equal((await patch(app, id, {})).status, 400);
  assert.equal((await patch(app, id, { nope: 1 })).status, 400);
  assert.equal((await patch(other, id, { score: 5 })).status, 404);
  assert.equal((await patch(app, 999999, { score: 5 })).status, 404);
});

const criteria = [
  { name: 'Stack-Passung', weight: 60, fulfilled: 50 },
  { name: 'Standort & Pendeln', weight: 40, fulfilled: 75 },
];

async function firstLeadId(app: App): Promise<number> {
  await post(app, { leads: [lead(1)] });
  const [{ id }] = (await (await app.request('/api/v1/job-leads')).json()) as { id: number }[];
  return id;
}

test('PATCH keeps the criteria breakdown and exclusion of a rating', async () => {
  const app = testApp(createTestUser());
  const id = await firstLeadId(app);
  const res = await patch(app, id, { status: 'rated', score: 60, verdict: 'Passt', criteria, exclusion: 'Freelance' });
  assert.equal(res.status, 200);
  const updated = (await res.json()) as Record<string, unknown>;
  assert.deepEqual(updated.criteria, criteria);
  assert.equal(updated.exclusion, 'Freelance');
  const [listed] = (await (await app.request('/api/v1/job-leads')).json()) as Record<string, unknown>[];
  assert.deepEqual(listed.criteria, criteria);
  assert.equal(listed.exclusion, 'Freelance');
});

test('PATCH accepts a lead score below its breakdown but not above it', async () => {
  const app = testApp(createTestUser());
  const id = await firstLeadId(app);
  assert.equal((await patch(app, id, { score: 62, criteria })).status, 400);
  assert.equal((await patch(app, id, { score: 61, criteria })).status, 200);
  assert.equal((await patch(app, id, { score: 20, criteria, exclusion: 'Freelance' })).status, 200);
});

test('PATCH rejects a breakdown without a score, a broken breakdown, or an exclusion alone', async () => {
  const app = testApp(createTestUser());
  const id = await firstLeadId(app);
  assert.equal((await patch(app, id, { criteria })).status, 400);
  assert.equal((await patch(app, id, { score: 60, criteria: [{ ...criteria[0], weight: 50 }, criteria[1]] })).status, 400);
  assert.equal((await patch(app, id, { score: 60, exclusion: 'Freelance' })).status, 400);
  assert.equal((await patch(app, id, { score: 60, criteria, exclusion: '' })).status, 400);
});

test('clearing the score or the criteria removes the breakdown', async () => {
  const app = testApp(createTestUser());
  const id = await firstLeadId(app);
  await patch(app, id, { score: 60, criteria, exclusion: 'Freelance' });
  const cleared = (await (await patch(app, id, { score: null })).json()) as Record<string, unknown>;
  assert.ok(!('criteria' in cleared) && !('exclusion' in cleared));
  await patch(app, id, { score: 60, criteria });
  const dropped = (await (await patch(app, id, { score: 55, criteria: null })).json()) as Record<string, unknown>;
  assert.equal(dropped.score, 55);
  assert.ok(!('criteria' in dropped));
});

test('a lead rated without a breakdown has no criteria key', async () => {
  const app = testApp(createTestUser());
  const id = await firstLeadId(app);
  const rated = (await (await patch(app, id, { score: 70, verdict: 'ok' })).json()) as Record<string, unknown>;
  assert.ok(!('criteria' in rated) && !('exclusion' in rated));
});
