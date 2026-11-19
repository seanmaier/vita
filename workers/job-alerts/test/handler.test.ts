import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { assert, expect, test, vi } from 'vitest';
import { gzipSync } from 'node:zlib';
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

/** By default Cloudflare's topmost header confirms the envelope sender by SPF, as for real forwards. */
function fakeMessage(from: string, raw: string, { spf = true } = {}) {
  if (spf)
    raw = `Authentication-Results: mx.cloudflare.net; spf=pass smtp.mailfrom=${from}
${raw}`;
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

async function captureLogs(run: () => Promise<unknown>): Promise<string[]> {
  const logs: string[] = [];
  const original = console.log;
  console.log = (...args: unknown[]) => logs.push(args.join(' '));
  try {
    await run();
  } finally {
    console.log = original;
  }
  return logs;
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
  expect(await handleEmail(m.message, env, f.impl, noSleep)).toBe('delivered');
  expect(f.calls[0].url).toBe('https://app.test/api/v1/inbound-mail');
  const body = bodyOf(f);
  expect(body.kind).toBe('confirmation');
  expect(body.recipient).toBe(RECIPIENT);
  expect(body.envelopeFrom).toBe('Forwarding-NoReply@Google.com');
  expect(body.detail).toBe('code: 123456\nurl: https://mail.google.com/mail/vf-abc');
  expect(body.leads).toBe(undefined);
});

test('confirmation without a code still posts with a fallback detail', async () => {
  const m = fakeMessage('forwarding-noreply@google.com', rawMail('x@google.com', 'hello', 'text/plain'));
  const f = fakeFetch(201);
  await handleEmail(m.message, env, f.impl, noSleep);
  expect(bodyOf(f).kind).toBe('confirmation');
  expect(bodyOf(f).detail).toBe('no code found');
});

test('looser google.com senders are not treated as confirmation', async () => {
  const m = fakeMessage('evil-forwarding-noreply@google.com', rawMail('x@google.com', 'code'));
  const f = fakeFetch(201);
  await handleEmail(m.message, env, f.impl, noSleep);
  expect(bodyOf(f).kind).toBe('failed');
});

test('valid LinkedIn alert is posted as leads with recipient and bearer token', async () => {
  const m = fakeMessage(GMAIL_ENVELOPE, rawMail('LinkedIn <jobalerts-noreply@linkedin.com>', linkedinHtml));
  const f = fakeFetch(201);
  expect(await handleEmail(m.message, env, f.impl, noSleep)).toBe('delivered');
  expect(f.calls.length).toBe(1);
  expect(f.calls[0].url).toBe('https://app.test/api/v1/inbound-mail');
  const headers = f.calls[0].init.headers as Record<string, string>;
  expect(headers.Authorization).toBe('Bearer tok-123');
  expect(headers['CF-Access-Client-Id']).toBe(undefined);
  const body = bodyOf(f);
  expect(body.kind).toBe('leads');
  expect(body.recipient).toBe(RECIPIENT);
  expect(body.envelopeFrom).toBe(GMAIL_ENVELOPE);
  expect(body.subject).toBe('Neue Jobs');
  expect(body.sender).toBe('LinkedIn <jobalerts-noreply@linkedin.com>');
  expect(body.leads.length).toBeGreaterThan(0);
  expect(body.leads[0].source).toBe('linkedin');
});

test('an Instaffo mail (html + text part) is posted as leads built from both parts', async () => {
  const part = (name: string) => readFileSync(join(import.meta.dirname, 'fixtures', name), 'utf8');
  const multipart = [
    '--b1',
    'Content-Type: text/plain; charset=utf-8',
    '',
    part('instaffo-top-match.txt'),
    '--b1',
    'Content-Type: text/html; charset=utf-8',
    '',
    part('instaffo-top-match.html'),
    '--b1--',
  ].join('\r\n');
  const raw = rawMail('Instaffo <notifications@app.instaffo.com>', multipart, 'multipart/alternative; boundary="b1"');
  const m = fakeMessage(GMAIL_ENVELOPE, raw);
  const f = fakeFetch(201);
  expect(await handleEmail(m.message, env, f.impl, noSleep)).toBe('delivered');
  expect(bodyOf(f).leads).toEqual([
    {
      source: 'instaffo',
      externalId: '0adc31c6-604b-41c1-9ae0-caa338763987',
      title: 'Backend and Platform Engineer (m/w/d)',
      company: 'Beispiel AI GmbH',
      url: 'https://app.instaffo.com/candidate/job/0adc31c6-604b-41c1-9ae0-caa338763987',
    },
  ]);
});

test('Cloudflare Access headers are sent when configured', async () => {
  const m = fakeMessage(GMAIL_ENVELOPE, rawMail('jobalerts-noreply@linkedin.com', linkedinHtml));
  const f = fakeFetch(201);
  await handleEmail(m.message, { ...env, CF_ACCESS_CLIENT_ID: 'id', CF_ACCESS_CLIENT_SECRET: 'sec' }, f.impl, noSleep);
  const headers = f.calls[0].init.headers as Record<string, string>;
  expect(headers['CF-Access-Client-Id']).toBe('id');
  expect(headers['CF-Access-Client-Secret']).toBe('sec');
});

test('unknown alert sender is posted as failed', async () => {
  const m = fakeMessage(GMAIL_ENVELOPE, rawMail('news@unknown.example', linkedinHtml));
  const f = fakeFetch(201);
  expect(await handleEmail(m.message, env, f.impl, noSleep)).toBe('delivered');
  expect(bodyOf(f).kind).toBe('failed');
  expect(bodyOf(f).detail).toBe('unknown alert sender');
  expect(bodyOf(f).leads).toBe(undefined);
});

test('mail without leads is posted as failed', async () => {
  const m = fakeMessage(GMAIL_ENVELOPE, rawMail('jobalerts-noreply@linkedin.com', '<p>nothing</p>'));
  const f = fakeFetch(201);
  expect(await handleEmail(m.message, env, f.impl, noSleep)).toBe('delivered');
  expect(bodyOf(f).kind).toBe('failed');
  expect(bodyOf(f).detail).toBe('no leads found');
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
  expect(bodyOf(f).subject.length).toBe(300);
  expect(bodyOf(f).sender.length).toBe(300);
});

test('404 from the app rejects the mail and is not retried', async () => {
  const m = fakeMessage(GMAIL_ENVELOPE, rawMail('jobalerts-noreply@linkedin.com', linkedinHtml));
  const f = fakeFetch(404);
  expect(await handleEmail(m.message, env, f.impl, noSleep)).toBe('rejected');
  expect(f.calls.length).toBe(1);
  expect(m.rejects).toEqual(['not accepted']);
});

test('403 and 400 from the app reject the mail', async () => {
  for (const status of [403, 400]) {
    const m = fakeMessage(GMAIL_ENVELOPE, rawMail('jobalerts-noreply@linkedin.com', linkedinHtml));
    expect(await handleEmail(m.message, env, fakeFetch(status).impl, noSleep)).toBe('rejected');
    expect(m.rejects).toEqual(['not accepted']);
  }
});

test("a rejection logs the app's error message, so the three 403 causes can be told apart", async () => {
  const m = fakeMessage(GMAIL_ENVELOPE, rawMail('jobalerts-noreply@linkedin.com', linkedinHtml));
  const impl = (async () =>
    Response.json({ error: 'This endpoint is for the mail worker only.' }, { status: 403 })) as unknown as typeof fetch;
  const logs = await captureLogs(() => handleEmail(m.message, env, impl, noSleep));
  expect(
    logs.some((l) => l.includes('status=403') && l.includes('reason="This endpoint is for the mail worker only."')),
    logs.join('\n'),
  ).toBeTruthy();
});

test('a rejection without a JSON error (e.g. an HTML page) logs no reason', async () => {
  const m = fakeMessage(GMAIL_ENVELOPE, rawMail('jobalerts-noreply@linkedin.com', linkedinHtml));
  const impl = (async () => new Response('<html>Forbidden</html>', { status: 403 })) as unknown as typeof fetch;
  const logs = await captureLogs(() => handleEmail(m.message, env, impl, noSleep));
  const line = logs.find((l) => l.includes('status=403'));
  expect(line && !line.includes('reason='), logs.join('\n')).toBeTruthy();
});

test('two 502s lead to a temporary rejection after one retry', async () => {
  const m = fakeMessage(GMAIL_ENVELOPE, rawMail('jobalerts-noreply@linkedin.com', linkedinHtml));
  const f = fakeFetch(502, 502);
  let slept = 0;
  const result = await handleEmail(m.message, env, f.impl, async (ms) => {
    slept = ms;
  });
  expect(result).toBe('unavailable');
  expect(f.calls.length).toBe(2);
  expect(slept).toBe(2000);
  expect(m.rejects).toEqual(['Vita is unavailable right now; please forward this mail again later']);
});

test('a network error followed by success is delivered', async () => {
  const m = fakeMessage(GMAIL_ENVELOPE, rawMail('jobalerts-noreply@linkedin.com', linkedinHtml));
  const f = fakeFetch(new Error('boom'), 201);
  expect(await handleEmail(m.message, env, f.impl, noSleep)).toBe('delivered');
  expect(f.calls.length).toBe(2);
  expect(m.rejects).toEqual([]);
});

test('a redirect is no success and ends temporarily rejected', async () => {
  const m = fakeMessage(GMAIL_ENVELOPE, rawMail('jobalerts-noreply@linkedin.com', linkedinHtml));
  const f = fakeFetch(302);
  expect(await handleEmail(m.message, env, f.impl, noSleep)).toBe('unavailable');
  expect((f.calls[0].init as RequestInit).redirect).toBe('manual');
  expect(m.rejects).toEqual(['Vita is unavailable right now; please forward this mail again later']);
});

test('a 200 response (e.g. login page) is not treated as delivered', async () => {
  const m = fakeMessage(GMAIL_ENVELOPE, rawMail('jobalerts-noreply@linkedin.com', linkedinHtml));
  expect(await handleEmail(m.message, env, fakeFetch(200).impl, noSleep)).toBe('unavailable');
});

test('leads are capped at 100 per batch and titles at 300 chars', async () => {
  const anchors = Array.from(
    { length: 120 },
    (_, i) => `<a href="https://www.linkedin.com/jobs/view/${1000 + i}/">${'T'.repeat(i === 0 ? 400 : 10)}${i}</a>`,
  ).join('\n');
  const m = fakeMessage(GMAIL_ENVELOPE, rawMail('jobalerts-noreply@linkedin.com', anchors));
  const f = fakeFetch(201);
  expect(await handleEmail(m.message, env, f.impl, noSleep)).toBe('delivered');
  const body = bodyOf(f);
  expect(body.leads.length).toBe(100);
  expect(body.leads.every((l: { title: string }) => l.title.length <= 300)).toBeTruthy();
});

test('sanitize drops https urls that do not parse', () => {
  const lead = (url: string) => ({ source: 'linkedin' as const, externalId: '1', title: 'T', url });
  const clean = sanitize([
    lead('https://'),
    lead('https://exa mple.com/x'),
    lead('https://www.linkedin.com/jobs/view/1/'),
  ]);
  expect(clean.map((l) => l.url)).toEqual(['https://www.linkedin.com/jobs/view/1/']);
});

test('APP_URL with trailing slashes does not produce a double slash', async () => {
  const m = fakeMessage(GMAIL_ENVELOPE, rawMail('jobalerts-noreply@linkedin.com', linkedinHtml));
  const f = fakeFetch(201);
  await handleEmail(m.message, { ...env, APP_URL: 'https://app.test//' }, f.impl, noSleep);
  expect(f.calls[0].url).toBe('https://app.test/api/v1/inbound-mail');
});

test('a raw stream that errors ends in a temporary rejection', async () => {
  const m = fakeMessage(GMAIL_ENVELOPE, 'x');
  m.message.raw = new ReadableStream({
    start(controller) {
      controller.error(new Error('broken'));
    },
  });
  const f = fakeFetch(201);
  expect(await handleEmail(m.message, env, f.impl, noSleep)).toBe('unavailable');
  expect(f.calls.length).toBe(0);
  expect(m.rejects).toEqual(['Vita is unavailable right now; please forward this mail again later']);
});

test('an unexpected error while building the payload ends in a temporary rejection', async () => {
  const m = fakeMessage(GMAIL_ENVELOPE, rawMail('jobalerts-noreply@linkedin.com', linkedinHtml));
  Object.defineProperty(m.message, 'to', {
    get() {
      throw new Error('stub failure');
    },
  });
  const f = fakeFetch(201);
  expect(await handleEmail(m.message, env, f.impl, noSleep)).toBe('unavailable');
  expect(m.rejects).toEqual(['Vita is unavailable right now; please forward this mail again later']);
});

test('the app call has a timeout signal and an abort is retried like a network error', async () => {
  const m = fakeMessage(GMAIL_ENVELOPE, rawMail('jobalerts-noreply@linkedin.com', linkedinHtml));
  const abort = new DOMException('The operation was aborted due to timeout', 'TimeoutError');
  const f = fakeFetch(abort as unknown as Error, 201);
  expect(await handleEmail(m.message, env, f.impl, noSleep)).toBe('delivered');
  expect(f.calls.length).toBe(2);
  expect(f.calls[0].init.signal).toBeInstanceOf(AbortSignal);
});

test('a missing APP_URL secret calls nothing and ends temporarily rejected', async () => {
  const m = fakeMessage(GMAIL_ENVELOPE, rawMail('jobalerts-noreply@linkedin.com', linkedinHtml));
  const f = fakeFetch(201);
  expect(await handleEmail(m.message, { ...env, APP_URL: '' }, f.impl, noSleep)).toBe('unavailable');
  expect(f.calls.length).toBe(0);
  expect(m.rejects).toEqual(['Vita is unavailable right now; please forward this mail again later']);
});

test('a mail forwarded by hand from iCloud is parsed by the platform in the quoted header', async () => {
  const jk = 'abcdefabcdef0123';
  const token = gzipSync(JSON.stringify({ u: `https://de.indeed.com/rc/clk?jk=${jk}` })).toString('base64url');
  const html =
    '<div>Begin forwarded message:</div><blockquote type="cite"><div><b>From:</b> Indeed &lt;donotreply@match.indeed.com&gt;<br>' +
    `<b>Subject:</b> Job</div></blockquote><blockquote type="cite"><a href="https://cts.indeed.com/v3/${token}/sig">Backend Dev</a></blockquote>`;
  const m = fakeMessage('me@icloud.com', rawMail('Me <me@icloud.com>', html));
  const f = fakeFetch(201);
  expect(await handleEmail(m.message, env, f.impl, noSleep)).toBe('delivered');
  const body = bodyOf(f);
  expect(body.kind).toBe('leads');
  expect(body.envelopeFrom).toBe('me@icloud.com');
  expect(body.leads).toEqual([
    { source: 'indeed', externalId: jk, title: 'Backend Dev', url: `https://de.indeed.com/viewjob?jk=${jk}` },
  ]);
});

test('a forward whose text part is one long line (iCloud after Outlook) still finds the platform', async () => {
  // Real shape: iCloud rewrites the text part into one line, own address first, the platform later.
  const text =
    'Begin forwarded message: From: Me <me@outlook.example> Subject: WG: Neue Jobs Date: 18 Nov 2026 at 22:59 ' +
    'To: "me@icloud.example" <me@icloud.example> Von: Indeed <donotreply@jobalert.indeed.com> Gesendet: Dienstag ' +
    'An: me@outlook.example Betreff: Neue Jobs 1 Backend Jobs in Hamburg Backend Dev Firma - Hamburg';
  const html =
    '<div>From: Me &lt;me@outlook.example&gt;</div><div>Von: Indeed &lt;donotreply@jobalert.indeed.com&gt;</div>' +
    '<a href="https://de.indeed.com/rc/clk/dl?jk=abcdefabcdef0123&amp;from=ja">Backend Dev</a>';
  const multipart = [
    '--b1',
    'Content-Type: text/plain; charset=utf-8',
    '',
    text,
    '--b1',
    'Content-Type: text/html; charset=utf-8',
    '',
    html,
    '--b1--',
  ].join('\r\n');
  const m = fakeMessage(
    'me@icloud.example',
    rawMail('Me <me@icloud.example>', multipart, 'multipart/alternative; boundary="b1"'),
  );
  const f = fakeFetch(201);
  expect(await handleEmail(m.message, env, f.impl, noSleep)).toBe('delivered');
  expect(bodyOf(f).kind).toBe('leads');
  expect(bodyOf(f).leads[0].externalId).toBe('abcdefabcdef0123');
});

/** A mail as Outlook sends it with "forward as attachment": a note from the user plus the original as .eml. */
function forwardedAsAttachment(original: string, disposition = 'attachment; filename="Neue Jobs.eml"'): string {
  return rawMail(
    'Me <me@outlook.example>',
    [
      '--outer',
      'Content-Type: text/plain; charset=utf-8',
      '',
      'Siehe Anlage',
      '--outer',
      'Content-Type: message/rfc822',
      `Content-Disposition: ${disposition}`,
      '',
      original,
      '--outer--',
    ].join('\r\n'),
    'multipart/mixed; boundary="outer"',
  ).replace('Subject: Neue Jobs', 'Subject: WG: Neue Jobs');
}

const instaffoOriginal = () => {
  const part = (name: string) => readFileSync(join(import.meta.dirname, 'fixtures', name), 'utf8');
  const body = [
    '--b1',
    'Content-Type: text/plain; charset=utf-8',
    '',
    part('instaffo-top-match.txt'),
    '--b1',
    'Content-Type: text/html; charset=utf-8',
    '',
    part('instaffo-top-match.html'),
    '--b1--',
  ].join('\r\n');
  return rawMail('Instaffo <notifications@app.instaffo.com>', body, 'multipart/alternative; boundary="b1"').replace(
    'Subject: Neue Jobs',
    'Subject: Neuer Top-Match',
  );
};

test('a mail forwarded as attachment is read from the attached original, text part included', async () => {
  for (const disposition of ['attachment; filename="Neue Jobs.eml"', 'inline']) {
    const m = fakeMessage('me@outlook.example', forwardedAsAttachment(instaffoOriginal(), disposition));
    const f = fakeFetch(201);
    expect(await handleEmail(m.message, env, f.impl, noSleep)).toBe('delivered');
    const body = bodyOf(f);
    expect(body.kind, disposition).toBe('leads');
    expect(body.envelopeFrom).toBe('me@outlook.example');
    expect(body.subject).toBe('Neuer Top-Match');
    expect(body.sender).toBe('Instaffo <notifications@app.instaffo.com>');
    expect(body.leads.map((l: { externalId: string }) => l.externalId)).toEqual([
      '0adc31c6-604b-41c1-9ae0-caa338763987',
    ]);
  }
});

test('an attached mail from an unknown sender is ignored, and the outer mail decides', async () => {
  const stranger = rawMail('Shop <news@shop.example>', '<a href="https://www.linkedin.com/jobs/view/42/">Dev</a>');
  const m = fakeMessage('me@outlook.example', forwardedAsAttachment(stranger));
  const f = fakeFetch(201);
  await handleEmail(m.message, env, f.impl, noSleep);
  expect(bodyOf(f).kind).toBe('failed');
  expect(bodyOf(f).detail).toBe('unknown alert sender');
});

test('an attached alert is not read when the outer mail fails SPF', async () => {
  const m = fakeMessage('me@outlook.example', forwardedAsAttachment(instaffoOriginal()), { spf: false });
  const f = fakeFetch(201);
  await handleEmail(m.message, env, f.impl, noSleep);
  expect(bodyOf(f).kind).toBe('failed');
  expect(bodyOf(f).detail).toBe('sender not verified (SPF)');
});

test('LOG_HEADERS=1 logs the header diagnostics, and delivery still happens', async () => {
  const logs: string[] = [];
  vi.spyOn(console, 'log').mockImplementation((line: string) => {
    logs.push(line);
  });
  const m = fakeMessage(GMAIL_ENVELOPE, rawMail('jobalerts-noreply@linkedin.com', linkedinHtml));
  const f = fakeFetch(201);
  expect(await handleEmail(m.message, { ...env, LOG_HEADERS: '1' }, f.impl, noSleep)).toBe('delivered');
  const line = logs.find((l) => l.startsWith('job-alerts: headers '));
  assert(line, 'expected a headers log line');
  const d = JSON.parse(line.slice('job-alerts: headers '.length));
  expect(d.envelopeFrom).toBe(GMAIL_ENVELOPE);
  expect(d.from).toBe('jobalerts-noreply@linkedin.com');
  expect(line, 'must not log the subject').not.toContain('Neue Jobs');
});

test('without LOG_HEADERS no header diagnostics are logged', async () => {
  const logs: string[] = [];
  vi.spyOn(console, 'log').mockImplementation((line: string) => {
    logs.push(line);
  });
  const m = fakeMessage(GMAIL_ENVELOPE, rawMail('jobalerts-noreply@linkedin.com', linkedinHtml));
  await handleEmail(m.message, env, fakeFetch(201).impl, noSleep);
  expect(logs).not.toContainEqual(expect.stringMatching(/^job-alerts: headers /));
});

test('a LinkedIn alert without Cloudflare SPF pass is posted as failed, not as leads', async () => {
  const m = fakeMessage(GMAIL_ENVELOPE, rawMail('LinkedIn <jobalerts-noreply@linkedin.com>', linkedinHtml), {
    spf: false,
  });
  const f = fakeFetch(201);
  expect(await handleEmail(m.message, env, f.impl, noSleep)).toBe('delivered');
  const body = bodyOf(f);
  expect(body.kind).toBe('failed');
  expect(body.detail).toBe('sender not verified (SPF)');
  expect(body.leads).toBe(undefined);
  // An unverified sender chooses these freely, so they are not stored.
  expect(body.subject).toBe(undefined);
  expect(body.sender).toBe(undefined);
});

test('a Gmail confirmation without SPF pass is posted as failed and carries no code', async () => {
  const raw = rawMail('Gmail Team <forwarding-noreply@google.com>', 'Confirmation code: 123456', 'text/plain');
  const m = fakeMessage('forwarding-noreply@google.com', raw, { spf: false });
  const f = fakeFetch(201);
  await handleEmail(m.message, env, f.impl, noSleep);
  expect(bodyOf(f).kind).toBe('failed');
  expect(bodyOf(f).detail).toBe('sender not verified (SPF)');
  expect(f.calls[0].init.body as string).not.toContain('123456');
});

test('an Outlook-redirected LinkedIn alert with SPF pass is posted as leads', async () => {
  const envelope = 'name+SRS=a=b=linkedin.com=jobalerts@outlook.com';
  const raw =
    `Authentication-Results: mx.cloudflare.net; dkim=neutral (body hash did not verify) header.d=linkedin.com; ` +
    `spf=pass (mx.cloudflare.net: domain of ${envelope} designates 2a01::3 as permitted sender) smtp.mailfrom=${envelope}
` +
    rawMail('LinkedIn <jobalerts-noreply@linkedin.com>', linkedinHtml);
  const m = fakeMessage(envelope, raw, { spf: false });
  const f = fakeFetch(201);
  await handleEmail(m.message, env, f.impl, noSleep);
  expect(bodyOf(f).kind).toBe('leads');
  expect(bodyOf(f).envelopeFrom).toBe(envelope);
});
