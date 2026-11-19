import assert from 'node:assert/strict';
import { test } from 'node:test';
import PostalMime from 'postal-mime';
import { headerDiagnostics } from '../src/diagnostics.ts';

const raw = [
  'Authentication-Results: mx.cloudflare.net; dkim=pass header.d=linkedin.com header.s=proddkim1024',
  'ARC-Authentication-Results: i=1; mx.microsoft.com 1; dkim=pass header.d=linkedin.com',
  'Received-SPF: pass (mx.cloudflare.net: domain of bounces@outlook.com designates 40.92.0.1 as permitted sender)',
  'DKIM-Signature: v=1; a=rsa-sha256; d=linkedin.com; s=proddkim1024; c=relaxed/relaxed; bh=abc=; b=SECRETSIGNATURE',
  'DKIM-Signature: v=1; a=rsa-sha256; d=outlook.com; s=selector1; b=OTHERSIGNATURE',
  'From: LinkedIn Job Alerts <jobalerts-noreply@linkedin.com>',
  'To: jobs-k7x2@alerts.example.org',
  'Subject: Private subject line',
  'Content-Type: text/plain; charset=utf-8',
  '',
  'Private body text',
].join('\r\n');

test('collects envelope, From and authentication headers, but no subject, body or signature', async () => {
  const parsed = await PostalMime.parse(raw);
  const d = headerDiagnostics(
    { from: 'SRS0=x=linkedin.com=jobalerts@outlook.com', to: 'jobs-k7x2@alerts.example.org' },
    parsed,
  );

  assert.equal(d.envelopeFrom, 'SRS0=x=linkedin.com=jobalerts@outlook.com');
  assert.equal(d.envelopeTo, 'jobs-k7x2@alerts.example.org');
  assert.equal(d.from, 'jobalerts-noreply@linkedin.com');
  assert.deepEqual(d.authenticationResults, [
    'mx.cloudflare.net; dkim=pass header.d=linkedin.com header.s=proddkim1024',
  ]);
  assert.equal(d.arcAuthenticationResults.length, 1);
  assert.equal(d.receivedSpf.length, 1);
  assert.deepEqual(d.dkimSignatures, [
    { d: 'linkedin.com', s: 'proddkim1024' },
    { d: 'outlook.com', s: 'selector1' },
  ]);

  const text = JSON.stringify(d);
  for (const secret of ['Private subject line', 'Private body text', 'SECRETSIGNATURE', 'OTHERSIGNATURE']) {
    assert.ok(!text.includes(secret), `must not log ${secret}`);
  }
});

test('works without a parsed mail', () => {
  const d = headerDiagnostics({ from: 'a@b.example', to: 'c@d.example' }, null);
  assert.equal(d.from, null);
  assert.deepEqual(d.dkimSignatures, []);
});

test('long header values are truncated', async () => {
  const parsed = await PostalMime.parse(`Authentication-Results: ${'x'.repeat(5000)}\r\nFrom: a@b.example\r\n\r\nbody`);
  const d = headerDiagnostics({ from: 'a@b.example', to: 'c@d.example' }, parsed);
  assert.ok(d.authenticationResults[0].length <= 1000);
});
