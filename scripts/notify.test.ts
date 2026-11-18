import { expect, test } from 'vitest';
import { buildNotification, resolveClickUrl } from './notify.ts';

const topic = 'a'.repeat(32);

test('builds a POST to the topic with title and tags', () => {
  const { url, init } = buildNotification({ baseUrl: 'https://ntfy.sh/', topic }, 'Stellenradar: 2 Treffer', 'body');
  expect(url).toBe(`https://ntfy.sh/${topic}`);
  expect(init.method).toBe('POST');
  expect(init.body).toBe('body');
  const headers = init.headers as Record<string, string>;
  expect(headers.Title).toBe('Stellenradar: 2 Treffer');
  expect(headers.Tags).toBe('briefcase');
  expect(headers).not.toHaveProperty('Click');
});

test('adds Click when a URL is given', () => {
  const { init } = buildNotification({ baseUrl: 'https://ntfy.sh', topic }, 't', 'b', 'https://example.org/leads');
  expect((init.headers as Record<string, string>).Click).toBe('https://example.org/leads');
});

test('umlauts in the title do not break the headers', () => {
  const { init } = buildNotification({ baseUrl: 'https://ntfy.sh', topic }, 'Stellenradar: Müller – Ärzte', 'b');
  expect(() => new Headers(init.headers)).not.toThrow();
  const title = (init.headers as Record<string, string>).Title;
  expect(title).toMatch(/^[\x20-\x7e]*$/);
  expect(title.startsWith('=?UTF-8?B?')).toBe(true);
  const b64 = title.slice('=?UTF-8?B?'.length, -2);
  expect(Buffer.from(b64, 'base64').toString('utf8')).toBe('Stellenradar: Müller – Ärzte');
});

test('rejects a topic shorter than 20 characters', () => {
  expect(() => buildNotification({ baseUrl: 'https://ntfy.sh', topic: 'short' }, 't', 'b')).toThrow(/20/);
});

test('a relative click URL is resolved against the app URL', () => {
  expect(resolveClickUrl('leads', 'https://vita.example.org/')).toBe('https://vita.example.org/leads');
  expect(resolveClickUrl('/leads', 'https://vita.example.org')).toBe('https://vita.example.org/leads');
});

test('an absolute click URL passes through and none stays none', () => {
  expect(resolveClickUrl('https://other.example/x', undefined)).toBe('https://other.example/x');
  expect(resolveClickUrl(undefined, 'https://vita.example.org')).toBe(undefined);
});

test('a relative click URL without an app URL is an error', () => {
  expect(() => resolveClickUrl('leads', undefined)).toThrow(/JOB_APPS_URL/);
});
