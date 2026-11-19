import { expect, test } from 'vitest';
import { createTestUser, testApp } from './test/testApp.ts';

const put = (app: ReturnType<typeof testApp>, doc: string, body: unknown) =>
  app.request(`/api/v1/knowledge/${doc}`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });

test('a document that was never saved is 404', async () => {
  const app = testApp(createTestUser());
  expect((await app.request('/api/v1/knowledge/about-me')).status).toBe(404);
});

test('a saved document reads back', async () => {
  const app = testApp(createTestUser());
  expect((await put(app, 'about-me', { content: '# Über mich' })).status).toBe(200);
  const res = await app.request('/api/v1/knowledge/about-me');
  expect(res.status).toBe(200);
  expect(await res.json()).toEqual({ doc: 'about-me', content: '# Über mich' });
});

test('documents are private per user', async () => {
  const first = testApp(createTestUser());
  const second = testApp(createTestUser());
  await put(first, 'priorities', { content: 'secret' });
  expect((await second.request('/api/v1/knowledge/priorities')).status).toBe(404);
});

test('an unknown document is 404', async () => {
  const app = testApp(createTestUser());
  expect((await put(app, 'passwords', { content: 'x' })).status).toBe(404);
  expect((await app.request('/api/v1/knowledge/passwords')).status).toBe(404);
});

test('invalid bodies are rejected with details', async () => {
  const app = testApp(createTestUser());
  for (const body of [{ content: 42 }, { content: 'x', extra: 1 }, { content: 'x'.repeat(200_001) }]) {
    const res = await put(app, 'about-me', body);
    expect(res.status).toBe(400);
    expect(Array.isArray(((await res.json()) as { details: unknown }).details)).toBeTruthy();
  }
});
