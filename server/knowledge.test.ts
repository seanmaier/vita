import './test/env.ts';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createTestUser, testApp } from './test/testApp.ts';

const put = (app: ReturnType<typeof testApp>, doc: string, body: unknown) =>
  app.request(`/api/v1/knowledge/${doc}`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });

test('a document that was never saved is 404', async () => {
  const app = testApp(createTestUser());
  assert.equal((await app.request('/api/v1/knowledge/about-me')).status, 404);
});

test('a saved document reads back', async () => {
  const app = testApp(createTestUser());
  assert.equal((await put(app, 'about-me', { content: '# Über mich' })).status, 200);
  const res = await app.request('/api/v1/knowledge/about-me');
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { doc: 'about-me', content: '# Über mich' });
});

test('documents are private per user', async () => {
  const first = testApp(createTestUser());
  const second = testApp(createTestUser());
  await put(first, 'priorities', { content: 'secret' });
  assert.equal((await second.request('/api/v1/knowledge/priorities')).status, 404);
});

test('an unknown document is 404', async () => {
  const app = testApp(createTestUser());
  assert.equal((await put(app, 'passwords', { content: 'x' })).status, 404);
  assert.equal((await app.request('/api/v1/knowledge/passwords')).status, 404);
});

test('invalid bodies are rejected with details', async () => {
  const app = testApp(createTestUser());
  for (const body of [{ content: 42 }, { content: 'x', extra: 1 }, { content: 'x'.repeat(200_001) }]) {
    const res = await put(app, 'about-me', body);
    assert.equal(res.status, 400);
    assert.ok(Array.isArray(((await res.json()) as { details: unknown }).details));
  }
});
