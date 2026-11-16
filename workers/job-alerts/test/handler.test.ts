import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { handleEmail, isFromOwnerGmail, type Env } from '../src/handler.ts';

const env: Env = {
  APP_URL: 'https://app.test',
  APP_TOKEN: 'tok-123',
  OWNER_GMAIL: 'owner.name@gmail.com',
  OWNER_EMAIL: 'owner@example.org',
};
const OWNER_ENVELOPE = 'owner.name+caf_=jobs=alerts.example.org@gmail.com';

const linkedinHtml = readFileSync(join(import.meta.dirname, 'fixtures', 'linkedin.html'), 'utf8');

function rawMail(fromHeader: string, html: string): string {
  return [
    `From: ${fromHeader}`,
    'To: jobs@alerts.example.org',
    'Subject: Neue Jobs',
    'MIME-Version: 1.0',
    'Content-Type: text/html; charset=utf-8',
    '',
    html,
  ].join('\r\n');
}

function fakeMessage(from: string, raw: string) {
  const forwards: { to: string; headers?: Headers }[] = [];
  const rejects: string[] = [];
  return {
    forwards,
    rejects,
    message: {
      from,
      to: 'jobs@alerts.example.org',
      headers: new Headers(),
      raw: new Response(raw).body as ReadableStream<Uint8Array>,
      forward: async (to: string, headers?: Headers) => {
        forwards.push({ to, headers });
        return { messageId: 'x' };
      },
      setReject: (reason: string) => {
        rejects.push(reason);
      },
    },
  };
}

function fakeFetch(...statuses: (number | Error)[]) {
  const calls: { url: string; init: RequestInit }[] = [];
  const impl = (async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    const next = statuses[Math.min(calls.length - 1, statuses.length - 1)];
    if (next instanceof Error) throw next;
    return new Response(JSON.stringify({ created: 1, duplicates: 0 }), { status: next });
  }) as unknown as typeof fetch;
  return { calls, impl };
}

const noSleep = async () => {};

test('isFromOwnerGmail ignores case and +suffix but nothing else', () => {
  assert.equal(isFromOwnerGmail('Owner.Name+caf_=jobs=alerts.example.org@gmail.com', 'owner.name@gmail.com'), true);
  assert.equal(isFromOwnerGmail('owner.name@gmail.com.evil.io', 'owner.name@gmail.com'), false);
  assert.equal(isFromOwnerGmail('other@gmail.com', 'owner.name@gmail.com'), false);
});

test('foreign envelope sender with spoofed From is rejected without calling the app', async () => {
  const m = fakeMessage('evil@attacker.io', rawMail('jobalerts-noreply@linkedin.com', linkedinHtml));
  const f = fakeFetch(201);
  assert.equal(await handleEmail(m.message, env, f.impl, noSleep), 'rejected');
  assert.equal(f.calls.length, 0);
  assert.deepEqual(m.rejects, ['not accepted']);
});

test('Gmail forwarding confirmation is forwarded to the owner', async () => {
  const m = fakeMessage('Forwarding-NoReply@Google.com', rawMail('x@google.com', 'code 123'));
  const f = fakeFetch(201);
  assert.equal(await handleEmail(m.message, env, f.impl, noSleep), 'confirmation');
  assert.equal(m.forwards[0].to, env.OWNER_EMAIL);
  assert.equal(f.calls.length, 0);
});

test('looser google.com senders are not treated as confirmation', async () => {
  const m = fakeMessage('evil-forwarding-noreply@google.com', rawMail('x@google.com', 'code'));
  assert.equal(await handleEmail(m.message, env, fakeFetch(201).impl, noSleep), 'rejected');
});

test('valid LinkedIn alert is posted with bearer token', async () => {
  const m = fakeMessage(OWNER_ENVELOPE, rawMail('LinkedIn <jobalerts-noreply@linkedin.com>', linkedinHtml));
  const f = fakeFetch(201);
  assert.equal(await handleEmail(m.message, env, f.impl, noSleep), 'ingested');
  assert.equal(f.calls.length, 1);
  assert.equal(f.calls[0].url, 'https://app.test/api/v1/job-leads');
  const headers = f.calls[0].init.headers as Record<string, string>;
  assert.equal(headers.Authorization, 'Bearer tok-123');
  assert.equal(headers['CF-Access-Client-Id'], undefined);
  const body = JSON.parse(f.calls[0].init.body as string);
  assert.ok(body.leads.length > 0);
  assert.equal(body.leads[0].source, 'linkedin');
  assert.equal(m.forwards.length, 0);
});

test('Cloudflare Access headers are sent when configured', async () => {
  const m = fakeMessage(OWNER_ENVELOPE, rawMail('jobalerts-noreply@linkedin.com', linkedinHtml));
  const f = fakeFetch(201);
  await handleEmail(m.message, { ...env, CF_ACCESS_CLIENT_ID: 'id', CF_ACCESS_CLIENT_SECRET: 'sec' }, f.impl, noSleep);
  const headers = f.calls[0].init.headers as Record<string, string>;
  assert.equal(headers['CF-Access-Client-Id'], 'id');
  assert.equal(headers['CF-Access-Client-Secret'], 'sec');
});

test('two 502s lead to forwarding with an error header', async () => {
  const m = fakeMessage(OWNER_ENVELOPE, rawMail('jobalerts-noreply@linkedin.com', linkedinHtml));
  const f = fakeFetch(502, 502);
  let slept = 0;
  const result = await handleEmail(m.message, env, f.impl, async (ms) => {
    slept = ms;
  });
  assert.equal(result, 'forwarded-on-error');
  assert.equal(f.calls.length, 2);
  assert.equal(slept, 2000);
  assert.equal(m.forwards[0].to, env.OWNER_EMAIL);
  assert.equal(m.forwards[0].headers?.get('X-Vita-Ingest-Error'), '502');
});

test('a network error followed by success is ingested', async () => {
  const m = fakeMessage(OWNER_ENVELOPE, rawMail('jobalerts-noreply@linkedin.com', linkedinHtml));
  const f = fakeFetch(new Error('boom'), 201);
  assert.equal(await handleEmail(m.message, env, f.impl, noSleep), 'ingested');
  assert.equal(f.calls.length, 2);
});

test('a 4xx is not retried and forwards the mail', async () => {
  const m = fakeMessage(OWNER_ENVELOPE, rawMail('jobalerts-noreply@linkedin.com', linkedinHtml));
  const f = fakeFetch(400);
  assert.equal(await handleEmail(m.message, env, f.impl, noSleep), 'forwarded-on-error');
  assert.equal(f.calls.length, 1);
  assert.equal(m.forwards[0].headers?.get('X-Vita-Ingest-Error'), '400');
});

test('unknown From domain is rejected', async () => {
  const m = fakeMessage(OWNER_ENVELOPE, rawMail('news@unknown.example', linkedinHtml));
  const f = fakeFetch(201);
  assert.equal(await handleEmail(m.message, env, f.impl, noSleep), 'rejected');
  assert.equal(f.calls.length, 0);
});

test('mail without leads is forwarded to the owner', async () => {
  const m = fakeMessage(OWNER_ENVELOPE, rawMail('jobalerts-noreply@linkedin.com', '<p>nothing</p>'));
  const f = fakeFetch(201);
  assert.equal(await handleEmail(m.message, env, f.impl, noSleep), 'forwarded-on-error');
  assert.equal(m.forwards[0].to, env.OWNER_EMAIL);
  assert.equal(f.calls.length, 0);
});

test('leads are capped at 100 per batch and titles at 300 chars', async () => {
  const anchors = Array.from(
    { length: 120 },
    (_, i) => `<a href="https://www.linkedin.com/jobs/view/${1000 + i}/">${'T'.repeat(i === 0 ? 400 : 10)}${i}</a>`,
  ).join('\n');
  const m = fakeMessage(OWNER_ENVELOPE, rawMail('jobalerts-noreply@linkedin.com', anchors));
  const f = fakeFetch(201);
  assert.equal(await handleEmail(m.message, env, f.impl, noSleep), 'ingested');
  const body = JSON.parse(f.calls[0].init.body as string);
  assert.equal(body.leads.length, 100);
  assert.ok(body.leads.every((l: { title: string }) => l.title.length <= 300));
});

test('a redirect is a non-retried failure that forwards the mail', async () => {
  const m = fakeMessage(OWNER_ENVELOPE, rawMail('jobalerts-noreply@linkedin.com', linkedinHtml));
  const f = fakeFetch(302);
  assert.equal(await handleEmail(m.message, env, f.impl, noSleep), 'forwarded-on-error');
  assert.equal(f.calls.length, 1);
  assert.equal((f.calls[0].init as RequestInit).redirect, 'manual');
  assert.equal(m.forwards[0].headers?.get('X-Vita-Ingest-Error'), '302');
});

test('a 200 response (e.g. login page) is not treated as ingested', async () => {
  const m = fakeMessage(OWNER_ENVELOPE, rawMail('jobalerts-noreply@linkedin.com', linkedinHtml));
  const f = fakeFetch(200);
  assert.equal(await handleEmail(m.message, env, f.impl, noSleep), 'forwarded-on-error');
  assert.equal(m.forwards[0].headers?.get('X-Vita-Ingest-Error'), '200');
});

test('isFromOwnerGmail folds gmail dots and googlemail.com, and fails closed on undefined', () => {
  assert.equal(isFromOwnerGmail('ownername+x@gmail.com', 'owner.name@gmail.com'), true);
  assert.equal(isFromOwnerGmail('owner.name@googlemail.com', 'ownername@gmail.com'), true);
  assert.equal(isFromOwnerGmail('owner.name@example.org', 'ownername@example.org'), false);
  assert.equal(isFromOwnerGmail('owner.name@gmail.com', undefined), false);
});
