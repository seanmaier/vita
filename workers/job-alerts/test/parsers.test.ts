import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { extractAnchors } from '../src/links.ts';
import { parseAlert, sourceForSender } from '../src/parsers.ts';

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

test('linkedin: one lead per job id, query variants merged', () => {
  const leads = parseAlert('linkedin', fixture('linkedin'));
  assert.equal(leads.length, 3);
  assert.deepEqual(leads[0], {
    source: 'linkedin',
    externalId: '3912345678',
    title: 'Senior Frontend Engineer (m/w/d)',
    url: 'https://www.linkedin.com/jobs/view/3912345678/',
  });
  assert.equal(leads[1].title, 'Fullstack Developer & Team Lead');
});

test('stepstone: id from inline.html link, url without query', () => {
  const leads = parseAlert('stepstone', fixture('stepstone'));
  assert.equal(leads.length, 3);
  assert.deepEqual(leads[0], {
    source: 'stepstone',
    externalId: '9876543',
    title: 'Softwareentwickler (m/w/d)',
    url: 'https://www.stepstone.de/stellenangebote--Softwareentwickler-m-w-d-Hamburg-Beispiel-AG--9876543-inline.html',
  });
});

test('indeed: id from jk parameter', () => {
  const leads = parseAlert('indeed', fixture('indeed'));
  assert.equal(leads.length, 3);
  assert.deepEqual(leads[0], {
    source: 'indeed',
    externalId: '1a2b3c4d5e6f7a8b',
    title: 'Frontend Developer React (m/w/d)',
    url: 'https://de.indeed.com/viewjob?jk=1a2b3c4d5e6f7a8b',
  });
});

test('glassdoor: id from jobListingId parameter', () => {
  const leads = parseAlert('glassdoor', fixture('glassdoor'));
  assert.equal(leads.length, 2);
  assert.deepEqual(leads[0], {
    source: 'glassdoor',
    externalId: '1009876543210',
    title: 'Frontend Engineer (m/w/d)',
    url: 'https://www.glassdoor.de/job-listing/index.htm?jl=1009876543210',
  });
});

test('an image link does not claim the id; a later text anchor supplies the title', () => {
  const html = `<a href="https://www.linkedin.com/comm/jobs/view/42/"><img src="x"></a>
    <a href="https://www.linkedin.com/comm/jobs/view/42/?x=1">Dev</a>`;
  const leads = parseAlert('linkedin', html);
  assert.deepEqual(leads, [
    { source: 'linkedin', externalId: '42', title: 'Dev', url: 'https://www.linkedin.com/jobs/view/42/' },
  ]);
});

test('sources without a parser yield no leads', () => {
  assert.deepEqual(parseAlert('other', fixture('linkedin')), []);
});
