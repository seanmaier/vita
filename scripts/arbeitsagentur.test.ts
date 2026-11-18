import { expect, test } from 'vitest';
import { readFileSync } from 'node:fs';
import { buildSearchUrl, toLead, toLeads } from './arbeitsagentur.ts';

const fixture = JSON.parse(readFileSync(new URL('./fixtures/arbeitsagentur.json', import.meta.url), 'utf8'));

test('toLead maps the first fixture entry', () => {
  expect(toLead(fixture.ergebnisliste[0])).toEqual({
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
  expect(lead).not.toHaveProperty('company');
  expect(lead).not.toHaveProperty('location');
  expect(lead.externalId).toBe('13509-0000211170f002-S');
});

test('toLead trims and respects server limits', () => {
  const lead = toLead({
    referenznummer: ' X-1 ',
    stellenangebotsTitel: ` ${'t'.repeat(400)} `,
    firma: 'f'.repeat(250),
    stellenlokationen: [{ adresse: { ort: 'o'.repeat(250) } }],
  });
  expect(lead.externalId).toBe('X-1');
  expect(lead.title.length).toBe(300);
  expect(lead.company?.length).toBe(200);
  expect(lead.location?.length).toBe(200);
});

test('toLeads skips items without refnr or title', () => {
  const leads = toLeads([
    ...fixture.ergebnisliste,
    { stellenangebotsTitel: 'no ref' },
    { referenznummer: 'Y-1' },
    { referenznummer: 'Y-2', stellenangebotsTitel: '   ' },
  ]);
  expect(leads.length).toBe(2);
});

test('buildSearchUrl encodes the query', () => {
  const url = new URL(buildSearchUrl({ was: 'C# Entwickler', wo: 'Hamburg', umkreis: 30, tage: 1 }));
  expect(url.pathname).toBe('/jobboerse/jobsuche-service/pc/v6/jobs');
  expect(url.searchParams.get('was')).toBe('C# Entwickler');
  expect(url.searchParams.get('umkreis')).toBe('30');
  expect(url.searchParams.get('veroeffentlichtseit')).toBe('1');
  expect(url.searchParams.get('angebotsart')).toBe('1');
  expect(url.searchParams.get('size')).toBe('100');
});
