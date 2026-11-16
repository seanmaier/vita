import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { buildSearchUrl, toLead, toLeads } from './arbeitsagentur.ts';

const fixture = JSON.parse(readFileSync(new URL('./fixtures/arbeitsagentur.json', import.meta.url), 'utf8'));

test('toLead maps the first fixture entry', () => {
  assert.deepEqual(toLead(fixture.ergebnisliste[0]), {
    source: 'arbeitsagentur',
    externalId: '10001-1004016786-S',
    title: 'Back-End Entwickler (m/w/d) – Mobile Applications',
    company: 'VAPS GmbH',
    location: 'Hamburg',
    url: 'https://www.arbeitsagentur.de/jobsuche/jobdetail/10001-1004016786-S',
  });
});

test('toLead leaves out company and location when missing', () => {
  const lead = toLead(fixture.ergebnisliste[1]);
  assert.equal('company' in lead, false);
  assert.equal('location' in lead, false);
  assert.equal(lead.externalId, '13509-0000211170f002-S');
});

test('toLead trims and respects server limits', () => {
  const lead = toLead({
    referenznummer: ' X-1 ',
    stellenangebotsTitel: ` ${'t'.repeat(400)} `,
    firma: 'f'.repeat(250),
    stellenlokationen: [{ adresse: { ort: 'o'.repeat(250) } }],
  });
  assert.equal(lead.externalId, 'X-1');
  assert.equal(lead.title.length, 300);
  assert.equal(lead.company?.length, 200);
  assert.equal(lead.location?.length, 200);
});

test('toLeads skips items without refnr or title', () => {
  const leads = toLeads([
    ...fixture.ergebnisliste,
    { stellenangebotsTitel: 'no ref' },
    { referenznummer: 'Y-1' },
    { referenznummer: 'Y-2', stellenangebotsTitel: '   ' },
  ]);
  assert.equal(leads.length, 2);
});

test('buildSearchUrl encodes the query', () => {
  const url = new URL(buildSearchUrl({ was: 'C# Entwickler', wo: 'Hamburg', umkreis: 30, tage: 1 }));
  assert.equal(url.pathname, '/jobboerse/jobsuche-service/pc/v6/jobs');
  assert.equal(url.searchParams.get('was'), 'C# Entwickler');
  assert.equal(url.searchParams.get('umkreis'), '30');
  assert.equal(url.searchParams.get('veroeffentlichtseit'), '1');
  assert.equal(url.searchParams.get('angebotsart'), '1');
  assert.equal(url.searchParams.get('size'), '100');
});
