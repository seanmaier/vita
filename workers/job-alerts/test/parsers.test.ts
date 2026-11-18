import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { gzipSync } from 'node:zlib';
import { extractAnchors, htmlToText, textNodes } from '../src/links.ts';
import { forwardedSource, parseAlert, sourceForSender } from '../src/parsers.ts';

const fixture = (name: string, ext = 'html') =>
  readFileSync(join(import.meta.dirname, 'fixtures', `${name}.${ext}`), 'utf8');

test('extractAnchors decodes entities, strips tags and collapses whitespace', () => {
  const anchors = extractAnchors(
    `<a class="x" href="https://e.com/?a=1&amp;b=2">  Foo &amp;\n <b>Bar</b> </a><a href='https://e.com/img'><img src="x"></a>`,
  );
  assert.deepEqual(
    anchors.map(({ href, text }) => ({ href, text })),
    [
      { href: 'https://e.com/?a=1&b=2', text: 'Foo & Bar' },
      { href: 'https://e.com/img', text: '' },
    ],
  );
});

test('extractAnchors keeps the link markup and the markup up to the next link', () => {
  const [first, second] = extractAnchors('<a href="https://e.com/1"><b>T</b></a><p>Firma</p><p>Ort</p><a href="https://e.com/2">x</a>tail');
  assert.equal(first.inner, '<b>T</b>');
  assert.equal(first.after, '<p>Firma</p><p>Ort</p>');
  assert.equal(second.after, 'tail');
});

test('textNodes returns the visible text pieces, decoded and without empty ones', () => {
  assert.deepEqual(textNodes('<p>A &amp; B</p>&nbsp;<!-- c --><span> \n C&#8203; </span>'), ['A & B', 'C']);
});

test('sourceForSender maps known sender domains', () => {
  assert.equal(sourceForSender('jobalerts-noreply@linkedin.com'), 'linkedin');
  assert.equal(sourceForSender('Jobs <alert@mail.stepstone.de>'), 'stepstone');
  assert.equal(sourceForSender('alert@indeed.com'), 'indeed');
  assert.equal(sourceForSender('alert@indeed.de'), 'indeed');
  assert.equal(sourceForSender('noreply@glassdoor.com'), 'glassdoor');
  assert.equal(sourceForSender('noreply@glassdoor.de'), 'glassdoor');
  assert.equal(sourceForSender('Instaffo <notifications@app.instaffo.com>'), 'instaffo');
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

test('indeed: id from jk parameter, company and location from the card', async () => {
  const leads = await parseAlert('indeed', fixture('indeed'));
  assert.deepEqual(leads, [
    {
      source: 'indeed',
      externalId: '1a2b3c4d5e6f7a8b',
      title: 'Frontend Developer React (m/w/d)',
      company: 'Beispiel Firma GmbH',
      location: 'Berlin',
      url: 'https://de.indeed.com/viewjob?jk=1a2b3c4d5e6f7a8b',
    },
    {
      source: 'indeed',
      externalId: 'ffeeddccbbaa9988',
      title: 'TypeScript Entwickler & Architekt',
      company: '100 - Muster Logistik SE & Co. KG',
      location: 'Hamburg',
      url: 'https://de.indeed.com/viewjob?jk=ffeeddccbbaa9988',
    },
    {
      source: 'indeed',
      externalId: '0011223344556677',
      title: 'Software Engineer Web',
      company: 'Beispiel AG',
      location: 'Remote',
      url: 'https://de.indeed.com/viewjob?jk=0011223344556677',
    },
  ]);
});

test('glassdoor: a card that is one big link yields the bold title plus company and location', async () => {
  const leads = await parseAlert('glassdoor', fixture('glassdoor'));
  assert.deepEqual(leads, [
    {
      source: 'glassdoor',
      externalId: '1009876543210',
      title: 'Frontend Engineer – Web & Mobile (m/w/d)',
      company: 'Beispiel Firma GmbH',
      location: 'Hamburg',
      url: 'https://www.glassdoor.de/job-listing/index.htm?jl=1009876543210',
    },
    {
      source: 'glassdoor',
      externalId: '1009876500001',
      title: 'Fullstack Entwickler',
      company: 'Muster AG',
      location: 'Remote',
      url: 'https://www.glassdoor.de/job-listing/index.htm?jl=1009876500001',
    },
  ]);
});

test('glassdoor: a plain title link without a card keeps its link text', async () => {
  const html = '<a href="https://www.glassdoor.de/partner/jobListing.htm?jobListingId=77">Dev (m/w/d)</a>';
  assert.deepEqual(await parseAlert('glassdoor', html), [
    { source: 'glassdoor', externalId: '77', title: 'Dev (m/w/d)', url: 'https://www.glassdoor.de/job-listing/index.htm?jl=77' },
  ]);
});

test('instaffo: digest titles from the html, job urls from the text part, without the login token', async () => {
  const leads = await parseAlert('instaffo', fixture('instaffo-digest'), fixture('instaffo-digest', 'txt'));
  assert.deepEqual(leads, [
    {
      source: 'instaffo',
      externalId: '04bb1c47-dbd8-4106-ae2a-d0c7e6c9f54d',
      title: 'Softwareentwickler Fullstack (m/w/d)',
      company: 'Beispiel Products AG',
      location: 'Münster',
      url: 'https://app.instaffo.com/candidate/job/04bb1c47-dbd8-4106-ae2a-d0c7e6c9f54d',
    },
    {
      source: 'instaffo',
      externalId: 'd0c595df-ae1b-4d91-b4ca-4c67c997a676',
      title: 'Fullstack-Developer (m/w/d) für C# & An…',
      company: 'Muster GmbH',
      location: 'Mannheim',
      url: 'https://app.instaffo.com/candidate/job/d0c595df-ae1b-4d91-b4ca-4c67c997a676',
    },
  ]);
});

test('instaffo: a single top-match mail', async () => {
  const leads = await parseAlert('instaffo', fixture('instaffo-top-match'), fixture('instaffo-top-match', 'txt'));
  assert.deepEqual(leads, [
    {
      source: 'instaffo',
      externalId: '0adc31c6-604b-41c1-9ae0-caa338763987',
      title: 'Backend and Platform Engineer (m/w/d)',
      company: 'Beispiel AI GmbH',
      url: 'https://app.instaffo.com/candidate/job/0adc31c6-604b-41c1-9ae0-caa338763987',
    },
  ]);
});

test('instaffo: without a text part, or with job links on foreign hosts, there are no leads', async () => {
  assert.deepEqual(await parseAlert('instaffo', fixture('instaffo-top-match')), []);
  const forged = fixture('instaffo-top-match', 'txt').replaceAll('https://app.instaffo.com/', 'https://app.instaffo.com.evil.example/');
  assert.deepEqual(await parseAlert('instaffo', fixture('instaffo-top-match'), forged), []);
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
