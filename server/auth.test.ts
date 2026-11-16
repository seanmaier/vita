import './test/env.ts';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { db } from './db.ts';
import { createApiToken, getApiToken, listApiTokens, parseUserTokenScope, tokenAllows } from './auth.ts';
import { createTestUser } from './test/testApp.ts';

test('an ingest token may only POST /api/v1/job-leads', () => {
  assert.equal(tokenAllows('job-leads:ingest', 'POST', '/api/v1/job-leads'), true);
  assert.equal(tokenAllows('job-leads:ingest', 'post', '/api/v1/job-leads'), true);
  assert.equal(tokenAllows('job-leads:ingest', 'GET', '/api/v1/job-leads'), false);
  assert.equal(tokenAllows('job-leads:ingest', 'POST', '/api/v1/job-leads/1'), false);
  assert.equal(tokenAllows('job-leads:ingest', 'POST', '/api/v1/job-leads/'), false);
  assert.equal(tokenAllows('job-leads:ingest', 'GET', '/api/v1/knowledge/about-me'), false);
});

test('a delivery token may only POST /api/v1/inbound-mail', () => {
  assert.equal(tokenAllows('inbound:deliver', 'POST', '/api/v1/inbound-mail'), true);
  assert.equal(tokenAllows('inbound:deliver', 'GET', '/api/v1/job-leads'), false);
  assert.equal(tokenAllows('inbound:deliver', 'PUT', '/api/v1/job-alerts'), false);
  assert.equal(tokenAllows('inbound:deliver', 'POST', '/api/v1/inbound-mail/x'), false);
});

test('a full token may call anything under /api/v1', () => {
  assert.equal(tokenAllows('full', 'GET', '/api/v1/knowledge/about-me'), true);
  assert.equal(tokenAllows('full', 'DELETE', '/api/v1/applications/1'), true);
});

test('createApiToken stores the scope and defaults to full', () => {
  const user = createTestUser();
  const scoped = createApiToken(user.id, 'worker', 'job-leads:ingest');
  const plain = createApiToken(user.id, 'laptop');
  assert.ok(scoped.ok && plain.ok);
  assert.equal(getApiToken(scoped.token)?.scope, 'job-leads:ingest');
  assert.equal(getApiToken(plain.token)?.scope, 'full');
  assert.equal(getApiToken(plain.token)?.user.id, user.id);
  assert.equal(getApiToken('jat_unknown'), null);
  // created_at has 1 s precision, so the list order isn't stable here.
  assert.deepEqual(Object.fromEntries(listApiTokens(user.id).map((t) => [t.name, t.scope])), {
    worker: 'job-leads:ingest',
    laptop: 'full',
  });
});

test('createApiToken rejects an unknown scope', () => {
  const user = createTestUser();
  const result = createApiToken(user.id, 'x', 'admin' as never);
  assert.equal(result.ok, false);
  assert.equal(!result.ok && result.status, 400);
});

test('getApiToken still records last use', () => {
  const user = createTestUser();
  const created = createApiToken(user.id, 'used');
  assert.ok(created.ok);
  assert.equal(listApiTokens(user.id)[0].last_used_at, null);
  getApiToken(created.token);
  assert.notEqual(listApiTokens(user.id)[0].last_used_at, null);
});

test('a token with an unknown stored scope is rejected', () => {
  const user = createTestUser();
  const created = createApiToken(user.id, 'tampered');
  assert.ok(created.ok);
  db.prepare("UPDATE api_tokens SET scope = 'admin' WHERE user_id = ?").run(user.id);
  assert.equal(getApiToken(created.token), null);
  assert.equal(tokenAllows('admin' as never, 'GET', '/api/v1/x'), false);
});

test('parseUserTokenScope allows only user scopes', () => {
  assert.deepEqual(parseUserTokenScope(undefined), { ok: true, scope: 'full' });
  assert.deepEqual(parseUserTokenScope('full'), { ok: true, scope: 'full' });
  assert.deepEqual(parseUserTokenScope('job-leads:ingest'), { ok: true, scope: 'job-leads:ingest' });
  for (const bad of ['inbound:deliver', 'admin', '', null, 42]) {
    assert.equal(parseUserTokenScope(bad).ok, false);
  }
});
