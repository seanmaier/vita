import { expect, test } from 'vitest';
import { createTestUser, testApp } from './test/testApp.ts';
import { db } from './db.ts';

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

test('posting leads creates them, and an identical repeat is all duplicates without updates', async () => {
  const app = testApp(createTestUser());
  const res = await post(app, { leads: [lead(1), lead(2)] });
  expect(res.status).toBe(201);
  expect(await res.json()).toEqual({ created: 2, duplicates: 0, updated: 0 });
  const again = await post(app, { leads: [lead(1), lead(2)] });
  expect(again.status).toBe(201);
  expect(await again.json()).toEqual({ created: 0, duplicates: 2, updated: 0 });
});

const listLeads = async (app: App) =>
  (await (await app.request('/api/v1/job-leads')).json()) as Record<string, unknown>[];

test('a known lead takes the new title, url, company and location', async () => {
  const app = testApp(createTestUser());
  await post(app, { leads: [lead(1, { title: 'HanseCom 2.6 ★ Dev Hamburg 11T' }), lead(2)] });
  const res = await post(app, {
    leads: [
      lead(1, { title: 'Dev', company: 'HanseCom', location: 'Hamburg', url: 'https://example.com/other' }),
      lead(2),
    ],
  });
  expect(await res.json()).toEqual({ created: 0, duplicates: 2, updated: 1 });
  const [, first] = await listLeads(app);
  expect(first.title).toBe('Dev');
  expect(first.company).toBe('HanseCom');
  expect(first.location).toBe('Hamburg');
  expect(first.url).toBe('https://example.com/other');
});

test('an update keeps company and location the new data lacks, and never touches the rating', async () => {
  const app = testApp(createTestUser());
  await post(app, { leads: [lead(1, { company: 'Firma', location: 'Köln' })] });
  const [{ id }] = await listLeads(app);
  await patch(app, id as number, { status: 'rated', score: 80, verdict: 'passt' });
  const res = await post(app, { leads: [lead(1, { title: 'Job 1 (m/w/d)' })] });
  expect(await res.json()).toEqual({ created: 0, duplicates: 1, updated: 1 });
  const [stored] = await listLeads(app);
  expect(stored.title).toBe('Job 1 (m/w/d)');
  expect(stored.company).toBe('Firma');
  expect(stored.location).toBe('Köln');
  expect(stored.status).toBe('rated');
  expect(stored.score).toBe(80);
  expect(stored.verdict).toBe('passt');
});

test('a repeat without new company or location is no update', async () => {
  const app = testApp(createTestUser());
  await post(app, { leads: [lead(1, { company: 'Firma' })] });
  const res = await post(app, { leads: [lead(1)] });
  expect(await res.json()).toEqual({ created: 0, duplicates: 1, updated: 0 });
});

test('another user with the same externalId is not affected by an update', async () => {
  const owner = testApp(createTestUser());
  const other = testApp(createTestUser());
  await post(owner, { leads: [lead(1)] });
  await post(other, { leads: [lead(1)] });
  await post(other, { leads: [lead(1, { title: 'Changed' })] });
  expect((await listLeads(owner))[0].title).toBe('Job 1');
});

test('non-https urls are rejected with an indexed detail', async () => {
  const app = testApp(createTestUser());
  for (const url of ['javascript:alert(1)', 'http://x.de']) {
    const res = await post(app, { leads: [lead(1), lead(2), lead(3), lead(4, { url })] });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { details: string[] };
    expect(body.details.some((d) => d.startsWith('leads[3].url'))).toBeTruthy();
  }
});

test('batch size and body shape are validated', async () => {
  const app = testApp(createTestUser());
  expect((await post(app, { leads: Array.from({ length: 101 }, (_, i) => lead(i)) })).status).toBe(400);
  expect((await post(app, { leads: [] })).status).toBe(400);
  expect((await post(app, {})).status).toBe(400);
  expect((await post(app, { leads: 'x' })).status).toBe(400);
  expect((await post(app, { leads: [lead(1)], extra: 1 })).status).toBe(400);
  expect((await post(app, { leads: [lead(1, { bogus: 1 })] })).status).toBe(400);
  expect((await post(app, { leads: [lead(1, { title: '   ' })] })).status).toBe(400);
});

test('blank company and location are stored as null, text is trimmed', async () => {
  const app = testApp(createTestUser());
  await post(app, { leads: [lead(1, { title: '  Dev  ', company: '  ', location: ' Köln ' })] });
  const [row] = (await (await app.request('/api/v1/job-leads')).json()) as Record<string, unknown>[];
  expect(row.title).toBe('Dev');
  expect(row.company).toBe(undefined);
  expect(row.location).toBe('Köln');
  expect(row.status).toBe('new');
  expect(row.externalId).toBe('ext-1');
});

test('GET filters by status, is newest first, and is private', async () => {
  const app = testApp(createTestUser());
  const other = testApp(createTestUser());
  await post(app, { leads: [lead(1), lead(2), lead(3)] });
  await post(other, { leads: [lead(9)] });
  const all = (await (await app.request('/api/v1/job-leads')).json()) as { id: number }[];
  expect(all.length).toBe(3);
  expect(all[0].id > all[1].id && all[1].id > all[2].id).toBeTruthy();
  await patch(app, all[0].id, { status: 'dismissed' });
  const fresh = (await (await app.request('/api/v1/job-leads?status=new')).json()) as { status: string }[];
  expect(fresh.length).toBe(2);
  expect(fresh.every((l) => l.status === 'new')).toBeTruthy();
  const limited = (await (await app.request('/api/v1/job-leads?limit=1')).json()) as unknown[];
  expect(limited.length).toBe(1);
});

test('GET rejects a bad status or limit', async () => {
  const app = testApp(createTestUser());
  for (const q of ['status=nope', 'limit=0', 'limit=201', 'limit=abc', 'limit=1.5']) {
    expect((await app.request(`/api/v1/job-leads?${q}`)).status, q).toBe(400);
  }
});

test('PATCH rates a lead and stamps ratedAt', async () => {
  const app = testApp(createTestUser());
  await post(app, { leads: [lead(1)] });
  const [{ id }] = (await (await app.request('/api/v1/job-leads')).json()) as { id: number }[];
  const res = await patch(app, id, { score: 82, verdict: 'Passt', status: 'rated' });
  expect(res.status).toBe(200);
  const updated = (await res.json()) as Record<string, unknown>;
  expect(updated.score).toBe(82);
  expect(updated.verdict).toBe('Passt');
  expect(updated.status).toBe('rated');
  expect(typeof updated.ratedAt).toBe('string');
  const cleared = (await (await patch(app, id, { score: null, applicationId: 'abc' })).json()) as Record<
    string,
    unknown
  >;
  expect(cleared.score).toBe(null);
  expect(cleared.ratedAt).toBe(null);
  expect(cleared.applicationId).toBe('abc');
});

test('PATCH validates input and scopes to the owner', async () => {
  const app = testApp(createTestUser());
  const other = testApp(createTestUser());
  await post(app, { leads: [lead(1)] });
  const [{ id }] = (await (await app.request('/api/v1/job-leads')).json()) as { id: number }[];
  expect((await patch(app, id, { score: 101 })).status).toBe(400);
  expect((await patch(app, id, { score: 1.5 })).status).toBe(400);
  expect((await patch(app, id, { status: 'bogus' })).status).toBe(400);
  expect((await patch(app, id, { verdict: 'x'.repeat(1001) })).status).toBe(400);
  expect((await patch(app, id, {})).status).toBe(400);
  expect((await patch(app, id, { nope: 1 })).status).toBe(400);
  expect((await patch(other, id, { score: 5 })).status).toBe(404);
  expect((await patch(app, 999999, { score: 5 })).status).toBe(404);
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
  expect(res.status).toBe(200);
  const updated = (await res.json()) as Record<string, unknown>;
  expect(updated.criteria).toEqual(criteria);
  expect(updated.exclusion).toBe('Freelance');
  const [listed] = (await (await app.request('/api/v1/job-leads')).json()) as Record<string, unknown>[];
  expect(listed.criteria).toEqual(criteria);
  expect(listed.exclusion).toBe('Freelance');
});

test('PATCH accepts a lead score below its breakdown but not above it', async () => {
  const app = testApp(createTestUser());
  const id = await firstLeadId(app);
  expect((await patch(app, id, { score: 62, criteria })).status).toBe(400);
  expect((await patch(app, id, { score: 61, criteria })).status).toBe(200);
  expect((await patch(app, id, { score: 20, criteria, exclusion: 'Freelance' })).status).toBe(200);
});

test('PATCH rejects a breakdown without a score, a broken breakdown, or an exclusion alone', async () => {
  const app = testApp(createTestUser());
  const id = await firstLeadId(app);
  expect((await patch(app, id, { criteria })).status).toBe(400);
  expect((await patch(app, id, { score: 60, criteria: [{ ...criteria[0], weight: 50 }, criteria[1]] })).status).toBe(
    400,
  );
  expect((await patch(app, id, { score: 60, exclusion: 'Freelance' })).status).toBe(400);
  expect((await patch(app, id, { score: 60, criteria, exclusion: '' })).status).toBe(400);
});

test('clearing the score or the criteria removes the breakdown', async () => {
  const app = testApp(createTestUser());
  const id = await firstLeadId(app);
  await patch(app, id, { score: 60, criteria, exclusion: 'Freelance' });
  const cleared = (await (await patch(app, id, { score: null })).json()) as Record<string, unknown>;
  expect(cleared).not.toHaveProperty('criteria');
  expect(cleared).not.toHaveProperty('exclusion');
  await patch(app, id, { score: 60, criteria });
  const dropped = (await (await patch(app, id, { score: 55, criteria: null })).json()) as Record<string, unknown>;
  expect(dropped.score).toBe(55);
  expect(dropped).not.toHaveProperty('criteria');
});

test('a lead rated without a breakdown has no criteria key', async () => {
  const app = testApp(createTestUser());
  const id = await firstLeadId(app);
  const rated = (await (await patch(app, id, { score: 70, verdict: 'ok' })).json()) as Record<string, unknown>;
  expect(rated).not.toHaveProperty('criteria');
  expect(rated).not.toHaveProperty('exclusion');
});

test('an exclusion without a criteria breakdown in the same request is a 400, also when null', async () => {
  const app = testApp(createTestUser());
  const id = await firstLeadId(app);
  expect((await patch(app, id, { exclusion: null })).status).toBe(400);
  expect((await patch(app, id, { score: 60, exclusion: null })).status).toBe(400);
  expect((await patch(app, id, { score: 60, criteria, exclusion: null })).status).toBe(200);
});

test('a rating with a breakdown is read, an estimated one may carry an exclusion without it', async () => {
  const app = testApp(createTestUser());
  const id = await firstLeadId(app);
  const read = (await (await patch(app, id, { score: 60, criteria })).json()) as Record<string, unknown>;
  expect(read.basis).toBe('read');
  const res = await patch(app, id, { score: 10, basis: 'estimated', verdict: 'ABAP', exclusion: 'SAP' });
  expect(res.status).toBe(200);
  const estimated = (await res.json()) as Record<string, unknown>;
  expect(estimated.basis).toBe('estimated');
  expect(estimated.exclusion).toBe('SAP');
  expect(estimated).not.toHaveProperty('criteria');
  const [listed] = (await (await app.request('/api/v1/job-leads')).json()) as Record<string, unknown>[];
  expect(listed.basis).toBe('estimated');
});

test('basis needs a score, is read or estimated, and an estimated rating has no breakdown', async () => {
  const app = testApp(createTestUser());
  const id = await firstLeadId(app);
  expect((await patch(app, id, { basis: 'estimated' })).status).toBe(400);
  expect((await patch(app, id, { score: 50, basis: 'guessed' })).status).toBe(400);
  expect((await patch(app, id, { score: 50, basis: null })).status).toBe(400);
  expect((await patch(app, id, { score: 50, basis: 'estimated', criteria })).status).toBe(400);
  expect((await patch(app, id, { score: 50, basis: 'read', exclusion: 'SAP' })).status).toBe(400);
  const plain = (await (await patch(app, id, { score: 50, basis: 'read' })).json()) as Record<string, unknown>;
  expect(plain.basis).toBe('read');
  expect(plain).not.toHaveProperty('criteria');
});

test('a new score without basis or breakdown drops the old basis', async () => {
  const app = testApp(createTestUser());
  const id = await firstLeadId(app);
  await patch(app, id, { score: 40, basis: 'estimated' });
  const rescored = (await (await patch(app, id, { score: 45, verdict: 'Passt' })).json()) as Record<string, unknown>;
  expect(rescored).not.toHaveProperty('basis');
});

test('leads rated before basis existed get it from their breakdown or the unreadable-posting verdict', async () => {
  const user = createTestUser();
  const app = testApp(user);
  await post(app, { leads: [lead(1), lead(2), lead(3)] });
  const rate = db.prepare(
    "UPDATE job_leads SET status = 'rated', score = ?, verdict = ?, rating = ? WHERE user_id = ? AND external_id = ?",
  );
  rate.run(60, 'Passt', JSON.stringify({ criteria }), user.id, 'ext-1');
  rate.run(25, 'Anzeige nicht lesbar; Product Owner.', null, user.id, 'ext-2');
  rate.run(70, 'Passt gut', null, user.id, 'ext-3');
  const leads = (await (await app.request('/api/v1/job-leads')).json()) as Record<string, unknown>[];
  const basis = Object.fromEntries(leads.map((l) => [l.externalId, l.basis]));
  expect(basis).toEqual({ 'ext-1': 'read', 'ext-2': 'estimated', 'ext-3': undefined });
});

test('a lead keeps the snippet of its alert, and a repeat fills in or refreshes it', async () => {
  const app = testApp(createTestUser());
  await post(app, { leads: [lead(1), lead(2, { snippet: '  65.000 € pro Jahr · Vor 1 Tag ' })] });
  const listed = async () =>
    Object.fromEntries(
      ((await (await app.request('/api/v1/job-leads')).json()) as Record<string, unknown>[]).map((l) => [
        l.externalId,
        l.snippet,
      ]),
    );
  expect(await listed()).toEqual({ 'ext-1': undefined, 'ext-2': '65.000 € pro Jahr · Vor 1 Tag' });
  const res = (await (await post(app, { leads: [lead(1, { snippet: 'Remote: Hybrid' }), lead(2)] })).json()) as Record<
    string,
    number
  >;
  expect(res).toMatchObject({ created: 0, duplicates: 2, updated: 1 });
  expect(await listed()).toEqual({ 'ext-1': 'Remote: Hybrid', 'ext-2': '65.000 € pro Jahr · Vor 1 Tag' });
});

test('a snippet longer than 500 characters is rejected', async () => {
  const app = testApp(createTestUser());
  const res = await post(app, { leads: [lead(1, { snippet: 'x'.repeat(501) })] });
  expect(res.status).toBe(400);
});
