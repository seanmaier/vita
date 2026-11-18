import { expect, onTestFinished, test } from 'vitest';
import { db } from './db.ts';
import { purgeOldInboundEvents } from './inboundMail.ts';
import { createTestUser, testApp } from './test/testApp.ts';

type App = ReturnType<typeof testApp>;
type Scope = 'inbound:deliver' | 'full' | 'cookie';
const json = { 'content-type': 'application/json' };
const lead = (n: number) => ({
  source: 'linkedin',
  externalId: `ext-${n}`,
  title: `Job ${n}`,
  url: `https://example.com/jobs/${n}`,
});

async function setup(gmail: string | null = 'owner.name@gmail.com') {
  const user = createTestUser();
  const app = testApp(user);
  const res = await app.request('/api/v1/job-alerts/address', { method: 'POST' });
  const { address } = (await res.json()) as { address: string };
  if (gmail) {
    await app.request('/api/v1/job-alerts', { method: 'PUT', headers: json, body: JSON.stringify({ forwardingFrom: gmail }) });
  }
  return { user, app, address };
}
// The caller is a service account, never the recipient: data must follow the recipient.
const deliver = (body: unknown, scope: Scope = 'inbound:deliver') =>
  testApp(createTestUser(), { scope: scope === 'cookie' ? undefined : scope }).request('/api/v1/inbound-mail', {
    method: 'POST',
    headers: json,
    body: JSON.stringify(body),
  });
const leadsOf = async (app: App) => (await app.request('/api/v1/job-leads')).json() as Promise<unknown[]>;
const eventsOf = async (app: App) =>
  (await app.request('/api/v1/job-alerts/events')).json() as Promise<{ kind: string; detail: string | null }[]>;

test('an unknown recipient is 404', async () => {
  const res = await deliver({ recipient: 'jobs-zzzzzzzzzz@alerts.example.org', envelopeFrom: 'a@gmail.com', kind: 'failed' });
  expect(res.status).toBe(404);
  expect(await res.json()).toEqual({ error: 'Unknown recipient.' });
});

test('a wrong domain is 404', async () => {
  const { address } = await setup();
  const res = await deliver({ recipient: address.replace('alerts.example.org', 'example.net'), envelopeFrom: 'owner.name@gmail.com', kind: 'failed' });
  expect(res.status).toBe(404);
});

test('a regenerated address invalidates the old one', async () => {
  const { app, address } = await setup();
  await app.request('/api/v1/job-alerts/address', { method: 'POST' });
  const res = await deliver({ recipient: address, envelopeFrom: 'owner.name@gmail.com', kind: 'failed' });
  expect(res.status).toBe(404);
});

test('leads from the matching gmail land at the recipient user only', async () => {
  const owner = await setup('owner.name@gmail.com');
  const other = await setup('someone@gmail.com');
  const res = await deliver({
    recipient: owner.address.replace('@alerts', '@ALERTS'),
    envelopeFrom: 'Ownername+x@googlemail.com',
    kind: 'leads',
    leads: [lead(1), lead(2)],
  });
  expect(res.status).toBe(201);
  expect(await res.json()).toEqual({ created: 2, duplicates: 0, updated: 0 });
  expect((await leadsOf(owner.app)).length).toBe(2);
  expect((await leadsOf(other.app)).length).toBe(0);
  expect((await eventsOf(owner.app))[0].kind).toBe('leads');
  expect((await eventsOf(owner.app))[0].detail).toBe('2 neu, 0 doppelt');
});

test('a re-forwarded alert repairs the leads it already created', async () => {
  const owner = await setup('owner.name@gmail.com');
  const send = (leads: unknown[]) =>
    deliver({ recipient: owner.address, envelopeFrom: 'owner.name@gmail.com', kind: 'leads', leads });
  await send([lead(1), lead(2)]);
  const res = await send([{ ...lead(1), title: 'Fixed title', company: 'Firma' }, lead(2), lead(3)]);
  expect(await res.json()).toEqual({ created: 1, duplicates: 2, updated: 1 });
  expect((await eventsOf(owner.app))[0].detail).toBe('1 neu, 2 doppelt, davon 1 aktualisiert');
});

test('leads from a foreign sender are refused and store nothing', async () => {
  const { app, address } = await setup();
  const res = await deliver({ recipient: address, envelopeFrom: 'owner.name@gmail.com.evil.io', kind: 'leads', leads: [lead(1)] });
  expect(res.status).toBe(403);
  expect((await leadsOf(app)).length).toBe(0);
});

test('leads and failed need a registered forwarding address', async () => {
  const { address } = await setup(null);
  for (const kind of ['leads', 'failed']) {
    const res = await deliver({ recipient: address, envelopeFrom: 'owner.name@gmail.com', kind, leads: [lead(1)] });
    expect(res.status).toBe(403);
  }
});

test('leads with no usable leads are 400', async () => {
  const { address } = await setup();
  const base = { recipient: address, envelopeFrom: 'owner.name@gmail.com', kind: 'leads' };
  expect((await deliver({ ...base, leads: [] })).status).toBe(400);
  expect((await deliver({ ...base, leads: [{ title: 'x' }] })).status).toBe(400);
  expect((await deliver(base)).status).toBe(400);
});

test('failed stores an event and truncates long fields', async () => {
  const { app, address } = await setup();
  const res = await deliver({
    recipient: address,
    envelopeFrom: 'owner.name@gmail.com',
    kind: 'failed',
    subject: 's'.repeat(500),
    sender: 'x'.repeat(500),
    detail: 'd'.repeat(3000),
  });
  expect(res.status).toBe(201);
  const events = (await (await app.request('/api/v1/job-alerts/events')).json()) as {
    kind: string;
    subject: string;
    sender: string;
    detail: string;
  }[];
  expect(events[0].kind).toBe('failed');
  expect(events[0].subject.length).toBe(300);
  expect(events[0].sender.length).toBe(300);
  expect(events[0].detail.length).toBe(2000);
});

test('a confirmation needs no registered gmail, only the Google sender', async () => {
  const { app, address } = await setup(null);
  const res = await deliver({ recipient: address, envelopeFrom: 'forwarding-noreply@google.com', kind: 'confirmation', subject: 'Confirm' });
  expect(res.status).toBe(201);
  expect((await eventsOf(app))[0].kind).toBe('confirmation');
  const bad = await deliver({ recipient: address, envelopeFrom: 'owner.name@gmail.com', kind: 'confirmation' });
  expect(bad.status).toBe(403);
});

test('only the inbound:deliver scope may deliver', async () => {
  const { address } = await setup();
  const body = { recipient: address, envelopeFrom: 'owner.name@gmail.com', kind: 'failed' };
  expect((await deliver(body, 'full')).status).toBe(403);
  expect((await deliver(body, 'cookie')).status).toBe(403);
  expect((await deliver(body, 'inbound:deliver')).status).toBe(201);
});

test('purgeOldInboundEvents deletes events older than 30 days only', async () => {
  const { user } = await setup();
  const insert = db.prepare("INSERT INTO inbound_events (user_id, kind, received_at) VALUES (?, 'failed', datetime('now', ?))");
  insert.run(user.id, '-31 days');
  insert.run(user.id, '-1 days');
  expect(purgeOldInboundEvents()).toBe(1);
  const left = db.prepare('SELECT COUNT(*) AS n FROM inbound_events WHERE user_id = ?').get(user.id) as { n: number };
  expect(left.n).toBe(1);
});

test('without INBOUND_DOMAIN every recipient is unknown', async () => {
  const { address } = await setup();
  const saved = process.env.INBOUND_DOMAIN;
  delete process.env.INBOUND_DOMAIN;
  onTestFinished(() => {
    process.env.INBOUND_DOMAIN = saved;
  });
  const res = await deliver({ recipient: address, envelopeFrom: 'owner.name@gmail.com', kind: 'failed' });
  expect(res.status).toBe(404);
});
