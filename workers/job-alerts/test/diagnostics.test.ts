import { expect, test } from 'vitest';
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

  expect(d.envelopeFrom).toBe('SRS0=x=linkedin.com=jobalerts@outlook.com');
  expect(d.envelopeTo).toBe('jobs-k7x2@alerts.example.org');
  expect(d.from).toBe('jobalerts-noreply@linkedin.com');
  expect(d.authenticationResults).toEqual(['mx.cloudflare.net; dkim=pass header.d=linkedin.com header.s=proddkim1024']);
  expect(d.arcAuthenticationResults.length).toBe(1);
  expect(d.receivedSpf.length).toBe(1);
  expect(d.dkimSignatures).toEqual([
    { d: 'linkedin.com', s: 'proddkim1024' },
    { d: 'outlook.com', s: 'selector1' },
  ]);

  const text = JSON.stringify(d);
  for (const secret of ['Private subject line', 'Private body text', 'SECRETSIGNATURE', 'OTHERSIGNATURE']) {
    expect(text, `must not log ${secret}`).not.toContain(secret);
  }
});

test('works without a parsed mail', () => {
  const d = headerDiagnostics({ from: 'a@b.example', to: 'c@d.example' }, null);
  expect(d.from).toBe(null);
  expect(d.dkimSignatures).toEqual([]);
});

test('long header values are truncated', async () => {
  const parsed = await PostalMime.parse(`Authentication-Results: ${'x'.repeat(5000)}\r\nFrom: a@b.example\r\n\r\nbody`);
  const d = headerDiagnostics({ from: 'a@b.example', to: 'c@d.example' }, parsed);
  expect(d.authenticationResults[0].length).toBeLessThanOrEqual(1000);
});
