import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { gzipSync } from 'node:zlib';
import { extractAnchors, htmlToText } from '../src/links.ts';
import { forwardedSource, parseAlert, sourceForSender } from '../src/parsers.ts';

const fixture = (name: string) =>
  readFileSync(join(import.meta.dirname, 'fixtures', `${name}.html`), 'utf8');

test('extractAnchors decodes entities, strips tags and collapses whitespace', () => {
  const anchors = extractAnchors(
    `<a class="x" href="https://e.com/?a=1&amp;b=2">  Foo &amp;\n <b>Bar</b> </a><a href='https://e.com/img'><img src="x"></a>`,
  );
  assert.deepEqual(anchors, [
    { href: 'https://e.com/?a=1&b=2', text: 'Foo & Bar' },
    { href: 'https://e.com/img', text: '' },
  ]);
});

test('sourceForSender maps known sender domains', () => {
  assert.equal(sourceForSender('jobalerts-noreply@linkedin.com'), 'linkedin');
  assert.equal(sourceForSender('Jobs <alert@mail.stepstone.de>'), 'stepstone');
  assert.equal(sourceForSender('alert@indeed.com'), 'indeed');
  assert.equal(sourceForSender('alert@indeed.de'), 'indeed');
  assert.equal(sourceForSender('noreply@glassdoor.com'), 'glassdoor');
  assert.equal(sourceForSender('noreply@glassdoor.de'), 'glassdoor');
  assert.equal(sourceForSender('x@evil.example'), null);
  assert.equal(sourceForSender('x@evil-linkedin.com'), null);
  assert.equal(sourceForSender('x@linkedin.com.evil.example'), null);
});

test('linkedin: one lead per job id, query variants merged', async () => {
  const leads = await parseAlert('linkedin', fixture('linkedin'));
  assert.equal(leads.length, 3);
  assert.deepEqual(leads[0], {
    source: 'linkedin',
    externalId: '3912345678',
    title: 'Senior Frontend Engineer (m/w/d)',
    url: 'https://www.linkedin.com/jobs/view/3912345678/',
  });
  assert.equal(leads[1].title, 'Fullstack Developer & Team Lead');
});

test('stepstone: id from inline.html link, url without query', async () => {
  const leads = await parseAlert('stepstone', fixture('stepstone'));
  assert.equal(leads.length, 3);
  assert.deepEqual(leads[0], {
    source: 'stepstone',
    externalId: '9876543',
    title: 'Softwareentwickler (m/w/d)',
    url: 'https://www.stepstone.de/stellenangebote--Softwareentwickler-m-w-d-Hamburg-Beispiel-AG--9876543-inline.html',
  });
});

test('indeed: id from jk parameter', async () => {
  const leads = await parseAlert('indeed', fixture('indeed'));
  assert.equal(leads.length, 3);
  assert.deepEqual(leads[0], {
    source: 'indeed',
    externalId: '1a2b3c4d5e6f7a8b',
    title: 'Frontend Developer React (m/w/d)',
    url: 'https://de.indeed.com/viewjob?jk=1a2b3c4d5e6f7a8b',
  });
});

test('glassdoor: id from jobListingId parameter', async () => {
  const leads = await parseAlert('glassdoor', fixture('glassdoor'));
  assert.equal(leads.length, 2);
  assert.deepEqual(leads[0], {
    source: 'glassdoor',
    externalId: '1009876543210',
    title: 'Frontend Engineer (m/w/d)',
    url: 'https://www.glassdoor.de/job-listing/index.htm?jl=1009876543210',
  });
});

test('an image link does not claim the id; a later text anchor supplies the title', async () => {
  const html = `<a href="https://www.linkedin.com/comm/jobs/view/42/"><img src="x"></a>
    <a href="https://www.linkedin.com/comm/jobs/view/42/?x=1">Dev</a>`;
  const leads = await parseAlert('linkedin', html);
  assert.deepEqual(leads, [
    { source: 'linkedin', externalId: '42', title: 'Dev', url: 'https://www.linkedin.com/jobs/view/42/' },
  ]);
});

test('sources without a parser yield no leads', async () => {
  assert.deepEqual(await parseAlert('other', fixture('linkedin')), []);
});

test('stepstone: links to foreign hosts or plain http are ignored', async () => {
  const html = [
    '<a href="https://evil.example/x--123-inline.html">Evil</a>',
    '<a href="https://stepstone.de.evil.example/x--124-inline.html">Lookalike</a>',
    '<a href="http://www.stepstone.de/x--125-inline.html">Plain http</a>',
    '<a href="https://www.stepstone.de/x--126-inline.html?foo=1#a">Real</a>',
  ].join('\n');
  const leads = await parseAlert('stepstone', html);
  assert.deepEqual(
    leads.map((l) => l.url),
    ['https://www.stepstone.de/x--126-inline.html'],
  );
});

/** A synthetic Indeed tracking link: cts.indeed.com/v3/<base64url gzip JSON>/<signature>. */
const indeedTracking = (target: unknown, host = 'cts.indeed.com') =>
  `https://${host}/v3/${gzipSync(JSON.stringify({ u: target, m: { clickType: 'viewjob' } })).toString('base64url')}/sig123`;

test('indeed: id from a cts.indeed.com tracking link', async () => {
  const job = indeedTracking('https://de.indeed.com/rc/clk?jk=0123456789abcdef&from=jobi2a_email&tk=x');
  const html = [
    `<a href="${job}"><img src="logo.png"></a>`,
    `<a href="${job}">Full-Stack-Entwickler:in (gn) in Dortmund</a>`,
    `<a href="${job}">Job anzeigen</a>`,
    `<a href="${indeedTracking('https://de.indeed.com/profile')}">Indeed Lebenslauf</a>`,
  ].join('\n');
  assert.deepEqual(await parseAlert('indeed', html), [
    {
      source: 'indeed',
      externalId: '0123456789abcdef',
      title: 'Full-Stack-Entwickler:in (gn) in Dortmund',
      url: 'https://de.indeed.com/viewjob?jk=0123456789abcdef',
    },
  ]);
});

test('indeed: tracking links on foreign hosts, to foreign targets or with broken tokens are ignored', async () => {
  const html = [
    `<a href="${indeedTracking('https://de.indeed.com/rc/clk?jk=1111111111111111', 'cts.indeed.com.evil.example')}">Lookalike host</a>`,
    `<a href="${indeedTracking('https://evil.example/rc/clk?jk=2222222222222222')}">Foreign target</a>`,
    `<a href="${indeedTracking(42)}">No url</a>`,
    '<a href="https://cts.indeed.com/v3/H4sInotgzip/sig">Broken token</a>',
    '<a href="http://cts.indeed.com/v3/H4sIAAAA/sig">Plain http</a>',
  ].join('\n');
  assert.deepEqual(await parseAlert('indeed', html), []);
});

test('indeed: a tracking token that inflates beyond the limit is ignored', async () => {
  const huge = `https://de.indeed.com/rc/clk?jk=3333333333333333&pad=${'a'.repeat(100_000)}`;
  assert.deepEqual(await parseAlert('indeed', `<a href="${indeedTracking(huge)}">Huge</a>`), []);
});

test('forwardedSource finds the platform in a hand-forwarded header block', () => {
  const iphone = htmlToText(
    '<div>Begin forwarded message:</div><blockquote><div><b>From:</b> Deniz &lt;me@icloud.com&gt;<br><b>To:</b> x</div></blockquote>' +
      '<blockquote><div><b>From:</b> Indeed &lt;donotreply@match.indeed.com&gt;<br><b>Subject:</b> Job</div></blockquote>',
  );
  assert.equal(forwardedSource(iphone), 'indeed');
  assert.equal(forwardedSource('---------- Forwarded message ---------\nVon: LinkedIn <jobs-noreply@linkedin.com>'), 'linkedin');
  assert.equal(forwardedSource('From: Friend <a@example.org>\nI like linkedin.com'), null);
  assert.equal(forwardedSource('From: x@evil-linkedin.com'), null);
});
