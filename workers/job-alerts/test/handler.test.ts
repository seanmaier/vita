import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { handleEmail, sanitize, type Env } from '../src/handler.ts';

const env: Env = {
  APP_URL: 'https://app.test',
  APP_TOKEN: 'tok-123',
};
const GMAIL_ENVELOPE = 'someone+caf_=jobs=alerts.example.org@gmail.com';
const RECIPIENT = 'jobs-k7x2@alerts.example.org';

const linkedinHtml = readFileSync(join(import.meta.dirname, 'fixtures', 'linkedin.html'), 'utf8');

function rawMail(fromHeader: string, html: string, contentType = 'text/html'): string {
  return [
    `From: ${fromHeader}`,
    `To: ${RECIPIENT}`,
    'Subject: Neue Jobs',
    'MIME-Version: 1.0',
    `Content-Type: ${contentType}; charset=utf-8`,
    '',
    html,
  ].join('\r\n');
}

function fakeMessage(from: string, raw: string) {
  const rejects: string[] = [];
  return {
    rejects,
    message: {
      from,
      to: RECIPIENT,
      headers: new Headers(),
      raw: new Response(raw).body as ReadableStream<Uint8Array>,
      forward: async (): Promise<EmailSendResult> => {
        throw new Error('forward must not be called');
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
    return new Response('{}', { status: next });
  }) as unknown as typeof fetch;
  return { calls, impl };
}

const bodyOf = (f: { calls: { init: RequestInit }[] }, i = 0) => JSON.parse(f.calls[i].init.body as string);

const noSleep = async () => {};

test('Gmail confirmation is posted with kind confirmation and the code', async () => {
  const raw = rawMail(
    'Gmail Team <forwarding-noreply@google.com>',
    'Confirmation code: 123456\nhttps://mail.google.com/mail/vf-abc',
    'text/plain',
  );
  const m = fakeMessage('Forwarding-NoReply@Google.com', raw);
  const f = fakeFetch(201);
  assert.equal(await handleEmail(m.message, env, f.impl, noSleep), 'delivered');
  assert.equal(f.calls[0].url, 'https://app.test/api/v1/inbound-mail');
  const body = bodyOf(f);
  assert.equal(body.kind, 'confirmation');
  assert.equal(body.recipient, RECIPIENT);
  assert.equal(body.envelopeFrom, 'Forwarding-NoReply@Google.com');
  assert.equal(body.detail, 'code: 123456\nurl: https://mail.google.com/mail/vf-abc');
  assert.equal(body.leads, undefined);
});

test('confirmation without a code still posts with a fallback detail', async () => {
  const m = fakeMessage('forwarding-noreply@google.com', rawMail('x@google.com', 'hello', 'text/plain'));
  const f = fakeFetch(201);
  await handleEmail(m.message, env, f.impl, noSleep);
  assert.equal(bodyOf(f).kind, 'confirmation');
  assert.equal(bodyOf(f).detail, 'no code found');
});

test('looser google.com senders are not treated as confirmation', async () => {
  const m = fakeMessage('evil-forwarding-noreply@google.com', rawMail('x@google.com', 'code'));
  const f = fakeFetch(201);
  await handleEmail(m.message, env, f.impl, noSleep);
  assert.equal(bodyOf(f).kind, 'failed');
});

test('valid LinkedIn alert is posted as leads with recipient and bearer token', async () => {
  const m = fakeMessage(GMAIL_ENVELOPE, rawMail('LinkedIn <jobalerts-noreply@linkedin.com>', linkedinHtml));
  const f = fakeFetch(201);
  assert.equal(await handleEmail(m.message, env, f.impl, noSleep), 'delivered');
  assert.equal(f.calls.length, 1);
  assert.equal(f.calls[0].url, 'https://app.test/api/v1/inbound-mail');
  const headers = f.calls[0].init.headers as Record<string, string>;
  assert.equal(headers.Authorization, 'Bearer tok-123');
  assert.equal(headers['CF-Access-Client-Id'], undefined);
  const body = bodyOf(f);
  assert.equal(body.kind, 'leads');
  assert.equal(body.recipient, RECIPIENT);
  assert.equal(body.envelopeFrom, GMAIL_ENVELOPE);
  assert.equal(body.subject, 'Neue Jobs');
  assert.equal(body.sender, 'LinkedIn <jobalerts-noreply@linkedin.com>');
  assert.ok(body.leads.length > 0);
  assert.equal(body.leads[0].source, 'linkedin');
});

test('Cloudflare Access headers are sent when configured', async () => {
  const m = fakeMessage(GMAIL_ENVELOPE, rawMail('jobalerts-noreply@linkedin.com', linkedinHtml));
  const f = fakeFetch(201);
  await handleEmail(m.message, { ...env, CF_ACCESS_CLIENT_ID: 'id', CF_ACCESS_CLIENT_SECRET: 'sec' }, f.impl, noSleep);
  const headers = f.calls[0].init.headers as Record<string, string>;
  assert.equal(headers['CF-Access-Client-Id'], 'id');
  assert.equal(headers['CF-Access-Client-Secret'], 'sec');
});

test('unknown alert sender is posted as failed', async () => {
  const m = fakeMessage(GMAIL_ENVELOPE, rawMail('news@unknown.example', linkedinHtml));
  const f = fakeFetch(201);
  assert.equal(await handleEmail(m.message, env, f.impl, noSleep), 'delivered');
  assert.equal(bodyOf(f).kind, 'failed');
  assert.equal(bodyOf(f).detail, 'unknown alert sender');
  assert.equal(bodyOf(f).leads, undefined);
});

test('mail without leads is posted as failed', async () => {
  const m = fakeMessage(GMAIL_ENVELOPE, rawMail('jobalerts-noreply@linkedin.com', '<p>nothing</p>'));
  const f = fakeFetch(201);
  assert.equal(await handleEmail(m.message, env, f.impl, noSleep), 'delivered');
  assert.equal(bodyOf(f).kind, 'failed');
  assert.equal(bodyOf(f).detail, 'no leads found');
});

test('subject and sender are truncated to 300 chars', async () => {
  const raw = [
    `From: ${'F'.repeat(400)} <jobalerts-noreply@linkedin.com>`,
    `To: ${RECIPIENT}`,
    `Subject: ${'S'.repeat(500)}`,
    'Content-Type: text/html; charset=utf-8',
    '',
    '<p>nothing</p>',
  ].join('\r\n');
  const m = fakeMessage(GMAIL_ENVELOPE, raw);
  const f = fakeFetch(201);
  await handleEmail(m.message, env, f.impl, noSleep);
  assert.equal(bodyOf(f).subject.length, 300);
  assert.equal(bodyOf(f).sender.length, 300);
});

test('404 from the app rejects the mail and is not retried', async () => {
  const m = fakeMessage(GMAIL_ENVELOPE, rawMail('jobalerts-noreply@linkedin.com', linkedinHtml));
  const f = fakeFetch(404);
  assert.equal(await handleEmail(m.message, env, f.impl, noSleep), 'rejected');
  assert.equal(f.calls.length, 1);
  assert.deepEqual(m.rejects, ['not accepted']);
});

test('403 and 400 from the app reject the mail', async () => {
  for (const status of [403, 400]) {
    const m = fakeMessage(GMAIL_ENVELOPE, rawMail('jobalerts-noreply@linkedin.com', linkedinHtml));
    assert.equal(await handleEmail(m.message, env, fakeFetch(status).impl, noSleep), 'rejected');
    assert.deepEqual(m.rejects, ['not accepted']);
  }
});

test('two 502s lead to a temporary rejection after one retry', async () => {
  const m = fakeMessage(GMAIL_ENVELOPE, rawMail('jobalerts-noreply@linkedin.com', linkedinHtml));
  const f = fakeFetch(502, 502);
  let slept = 0;
  const result = await handleEmail(m.message, env, f.impl, async (ms) => {
    slept = ms;
  });
  assert.equal(result, 'unavailable');
  assert.equal(f.calls.length, 2);
  assert.equal(slept, 2000);
  assert.deepEqual(m.rejects, ['Vita is unavailable right now; please forward this mail again later']);
});

test('a network error followed by success is delivered', async () => {
  const m = fakeMessage(GMAIL_ENVELOPE, rawMail('jobalerts-noreply@linkedin.com', linkedinHtml));
  const f = fakeFetch(new Error('boom'), 201);
  assert.equal(await handleEmail(m.message, env, f.impl, noSleep), 'delivered');
  assert.equal(f.calls.length, 2);
  assert.deepEqual(m.rejects, []);
});

test('a redirect is no success and ends temporarily rejected', async () => {
  const m = fakeMessage(GMAIL_ENVELOPE, rawMail('jobalerts-noreply@linkedin.com', linkedinHtml));
  const f = fakeFetch(302);
  assert.equal(await handleEmail(m.message, env, f.impl, noSleep), 'unavailable');
  assert.equal((f.calls[0].init as RequestInit).redirect, 'manual');
  assert.deepEqual(m.rejects, ['Vita is unavailable right now; please forward this mail again later']);
});

test('a 200 response (e.g. login page) is not treated as delivered', async () => {
  const m = fakeMessage(GMAIL_ENVELOPE, rawMail('jobalerts-noreply@linkedin.com', linkedinHtml));
  assert.equal(await handleEmail(m.message, env, fakeFetch(200).impl, noSleep), 'unavailable');
});

test('leads are capped at 100 per batch and titles at 300 chars', async () => {
  const anchors = Array.from(
    { length: 120 },
    (_, i) => `<a href="https://www.linkedin.com/jobs/view/${1000 + i}/">${'T'.repeat(i === 0 ? 400 : 10)}${i}</a>`,
  ).join('\n');
  const m = fakeMessage(GMAIL_ENVELOPE, rawMail('jobalerts-noreply@linkedin.com', anchors));
  const f = fakeFetch(201);
  assert.equal(await handleEmail(m.message, env, f.impl, noSleep), 'delivered');
  const body = bodyOf(f);
  assert.equal(body.leads.length, 100);
  assert.ok(body.leads.every((l: { title: string }) => l.title.length <= 300));
});

test('sanitize drops https urls that do not parse', () => {
  const lead = (url: string) => ({ source: 'linkedin' as const, externalId: '1', title: 'T', url });
  const clean = sanitize([lead('https://'), lead('https://exa mple.com/x'), lead('https://www.linkedin.com/jobs/view/1/')]);
  assert.deepEqual(
    clean.map((l) => l.url),
    ['https://www.linkedin.com/jobs/view/1/'],
  );
});

test('APP_URL with trailing slashes does not produce a double slash', async () => {
  const m = fakeMessage(GMAIL_ENVELOPE, rawMail('jobalerts-noreply@linkedin.com', linkedinHtml));
  const f = fakeFetch(201);
  await handleEmail(m.message, { ...env, APP_URL: 'https://app.test//' }, f.impl, noSleep);
  assert.equal(f.calls[0].url, 'https://app.test/api/v1/inbound-mail');
});

test('a raw stream that errors ends in a temporary rejection', async () => {
  const m = fakeMessage(GMAIL_ENVELOPE, 'x');
  m.message.raw = new ReadableStream({
    start(controller) {
      controller.error(new Error('broken'));
    },
  });
  const f = fakeFetch(201);
  assert.equal(await handleEmail(m.message, env, f.impl, noSleep), 'unavailable');
  assert.equal(f.calls.length, 0);
  assert.deepEqual(m.rejects, ['Vita is unavailable right now; please forward this mail again later']);
});

test('an unexpected error while building the payload ends in a temporary rejection', async () => {
  const m = fakeMessage(GMAIL_ENVELOPE, rawMail('jobalerts-noreply@linkedin.com', linkedinHtml));
  Object.defineProperty(m.message, 'to', {
    get() {
      throw new Error('stub failure');
    },
  });
  const f = fakeFetch(201);
  assert.equal(await handleEmail(m.message, env, f.impl, noSleep), 'unavailable');
  assert.deepEqual(m.rejects, ['Vita is unavailable right now; please forward this mail again later']);
});

test('the app call has a timeout signal and an abort is retried like a network error', async () => {
  const m = fakeMessage(GMAIL_ENVELOPE, rawMail('jobalerts-noreply@linkedin.com', linkedinHtml));
  const abort = new DOMException('The operation was aborted due to timeout', 'TimeoutError');
  const f = fakeFetch(abort as unknown as Error, 201);
  assert.equal(await handleEmail(m.message, env, f.impl, noSleep), 'delivered');
  assert.equal(f.calls.length, 2);
  assert.ok(f.calls[0].init.signal instanceof AbortSignal);
});
