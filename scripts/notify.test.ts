import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildNotification } from './notify.ts';

const topic = 'a'.repeat(32);

test('builds a POST to the topic with title and tags', () => {
  const { url, init } = buildNotification({ baseUrl: 'https://ntfy.sh/', topic }, 'Stellenradar: 2 Treffer', 'body');
  assert.equal(url, `https://ntfy.sh/${topic}`);
  assert.equal(init.method, 'POST');
  assert.equal(init.body, 'body');
  const headers = init.headers as Record<string, string>;
  assert.equal(headers.Title, 'Stellenradar: 2 Treffer');
  assert.equal(headers.Tags, 'briefcase');
  assert.equal('Click' in headers, false);
});

test('adds Click when a URL is given', () => {
  const { init } = buildNotification({ baseUrl: 'https://ntfy.sh', topic }, 't', 'b', 'https://example.org/leads');
  assert.equal((init.headers as Record<string, string>).Click, 'https://example.org/leads');
});

test('umlauts in the title do not break the headers', () => {
  const { init } = buildNotification({ baseUrl: 'https://ntfy.sh', topic }, 'Stellenradar: Müller – Ärzte', 'b');
  assert.doesNotThrow(() => new Headers(init.headers));
  const title = (init.headers as Record<string, string>).Title;
  assert.match(title, /^[\x20-\x7e]*$/);
  assert.equal(title.startsWith('=?UTF-8?B?'), true);
  const b64 = title.slice('=?UTF-8?B?'.length, -2);
  assert.equal(Buffer.from(b64, 'base64').toString('utf8'), 'Stellenradar: Müller – Ärzte');
});

test('rejects a topic shorter than 20 characters', () => {
  assert.throws(() => buildNotification({ baseUrl: 'https://ntfy.sh', topic: 'short' }, 't', 'b'), /20/);
});
