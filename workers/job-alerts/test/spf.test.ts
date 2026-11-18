import { expect, test } from 'vitest';
import { cloudflareSpfPass } from '../src/spf.ts';

// Shapes taken from real Cloudflare headers (addresses anonymized).
const ICLOUD =
  'mx.cloudflare.net; dkim=pass header.d=outlook.com header.s=selector1 header.b=DJUtvQoh; dmarc=none ' +
  'header.from=outlook.com policy.dmarc=none; spf=pass (mx.cloudflare.net: domain of postmaster@outbound.ci.icloud.com ' +
  'designates 2a01::12 as permitted sender) smtp.helo=outbound.ci.icloud.com; spf=pass (mx.cloudflare.net: domain of ' +
  'name@icloud.com designates 2a01::12 as permitted sender) smtp.mailfrom=name@icloud.com; arc=pass smtp.remote-ip="2a01::12"';
const OUTLOOK_ENVELOPE = 'name+SRS=ileBF=JF=icloud.com=other@outlook.com';
const OUTLOOK =
  'mx.cloudflare.net; dkim=neutral (body hash did not verify) header.d=icloud.com header.s=1a1hai header.b=qPv7iOds; ' +
  'dmarc=fail (policy not aligned) header.from=icloud.com policy.dmarc=quarantine; spf=pass (mx.cloudflare.net: domain ' +
  'of postmaster@WA0P291CU002.outbound.protection.outlook.com designates 2a01::3 as permitted sender) ' +
  'smtp.helo=WA0P291CU002.outbound.protection.outlook.com; spf=pass (mx.cloudflare.net: domain of ' +
  `${OUTLOOK_ENVELOPE} designates 2a01::3 as permitted sender) smtp.mailfrom=${OUTLOOK_ENVELOPE}; arc=pass ` +
  'smtp.remote-ip="2a01::3"';

test('iCloud forward with SPF pass for the envelope passes', () => {
  expect(cloudflareSpfPass([ICLOUD, 'arc.icloud.com; arc=pass'], 'name@icloud.com')).toBe(true);
});

test('Outlook redirect passes on SPF even though DKIM broke', () => {
  expect(cloudflareSpfPass([OUTLOOK], OUTLOOK_ENVELOPE)).toBe(true);
});

test('helo pass only', () => {
  const h = 'mx.cloudflare.net; spf=pass smtp.helo=mail.example.org; spf=fail smtp.mailfrom=a@example.org';
  expect(cloudflareSpfPass([h], 'a@example.org')).toBe(false);
});

test('mailfrom differs', () => {
  expect(cloudflareSpfPass(['mx.cloudflare.net; spf=pass smtp.mailfrom=other@example.org'], 'a@example.org')).toBe(false);
});

test('case-insensitive', () => {
  const h = 'mx.cloudflare.net; spf=pass smtp.mailfrom=forwarding-noreply@google.com';
  expect(cloudflareSpfPass([h], 'Forwarding-NoReply@Google.com')).toBe(true);
});

test('quoted mailfrom', () => {
  expect(cloudflareSpfPass(['mx.cloudflare.net; spf=pass smtp.mailfrom="a@example.org"'], 'a@example.org')).toBe(true);
});

test('forged lower header', () => {
  const headers = ['mx.cloudflare.net; spf=fail smtp.mailfrom=a@example.org', 'mx.cloudflare.net; spf=pass smtp.mailfrom=a@example.org'];
  expect(cloudflareSpfPass(headers, 'a@example.org')).toBe(false);
});

test('top header from someone else', () => {
  expect(cloudflareSpfPass(['mx.microsoft.com 1; spf=pass smtp.mailfrom=a@example.org'], 'a@example.org')).toBe(false);
});

test('authserv-id prefix trick', () => {
  const h = 'mx.cloudflare.net.evil.example; spf=pass smtp.mailfrom=a@example.org';
  expect(cloudflareSpfPass([h], 'a@example.org')).toBe(false);
});

test('no header', () => {
  expect(cloudflareSpfPass([], 'a@example.org')).toBe(false);
});

test('a comment cannot smuggle in a pass', () => {
  const h = 'mx.cloudflare.net; spf=fail (looks like; spf=pass smtp.mailfrom=a@example.org) smtp.mailfrom=a@example.org';
  expect(cloudflareSpfPass([h], 'a@example.org')).toBe(false);
});

test('a pass smuggled in through a broken comment does not count', () => {
  const h =
    'mx.cloudflare.net; spf=none (mx.cloudflare.net: no SPF record found for postmaster@x);spf=pass ' +
    'smtp.mailfrom=victim@gmail.com() smtp.helo=x; spf=softfail smtp.mailfrom=victim@gmail.com';
  expect(cloudflareSpfPass([h], 'victim@gmail.com')).toBe(false);
});

test('a pass smuggled in through a quoted HELO does not count', () => {
  const h =
    'mx.cloudflare.net; spf=none smtp.helo="a;spf=pass smtp.mailfrom=victim@gmail.com"; ' +
    'spf=softfail smtp.mailfrom=victim@gmail.com';
  expect(cloudflareSpfPass([h], 'victim@gmail.com')).toBe(false);
});

test('mailfrom followed by end of header or by another property', () => {
  expect(cloudflareSpfPass(['mx.cloudflare.net; spf=pass smtp.mailfrom=a@example.org'], 'a@example.org')).toBe(true);
  expect(cloudflareSpfPass(['mx.cloudflare.net; spf=pass smtp.mailfrom=a@example.org x=y'], 'a@example.org')).toBe(true);
});
