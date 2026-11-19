import { assert, expect, test } from 'vitest';
import { db } from './db.ts';
import {
  createApiToken,
  getApiToken,
  isAdmin,
  listApiTokens,
  parseUserTokenScope,
  rotateApiToken,
  setAdmin,
  tokenAllows,
} from './auth.ts';
import { createTestUser } from './test/testApp.ts';

test('an ingest token may only POST /api/v1/job-leads', () => {
  expect(tokenAllows('job-leads:ingest', 'POST', '/api/v1/job-leads')).toBe(true);
  expect(tokenAllows('job-leads:ingest', 'post', '/api/v1/job-leads')).toBe(true);
  expect(tokenAllows('job-leads:ingest', 'GET', '/api/v1/job-leads')).toBe(false);
  expect(tokenAllows('job-leads:ingest', 'POST', '/api/v1/job-leads/1')).toBe(false);
  expect(tokenAllows('job-leads:ingest', 'POST', '/api/v1/job-leads/')).toBe(false);
  expect(tokenAllows('job-leads:ingest', 'GET', '/api/v1/knowledge/about-me')).toBe(false);
});

test('a delivery token may only POST /api/v1/inbound-mail', () => {
  expect(tokenAllows('inbound:deliver', 'POST', '/api/v1/inbound-mail')).toBe(true);
  expect(tokenAllows('inbound:deliver', 'GET', '/api/v1/job-leads')).toBe(false);
  expect(tokenAllows('inbound:deliver', 'PUT', '/api/v1/job-alerts')).toBe(false);
  expect(tokenAllows('inbound:deliver', 'POST', '/api/v1/inbound-mail/x')).toBe(false);
});

test('a radar token may only touch job leads and read the knowledge it rates against', () => {
  const allows = (method: string, path: string) => tokenAllows('job-leads:radar', method, path);
  expect(allows('POST', '/api/v1/job-leads')).toBe(true);
  expect(allows('GET', '/api/v1/job-leads')).toBe(true);
  expect(allows('PATCH', '/api/v1/job-leads/42')).toBe(true);
  expect(allows('patch', '/api/v1/job-leads/7')).toBe(true);
  expect(allows('GET', '/api/v1/knowledge/priorities')).toBe(true);
  expect(allows('GET', '/api/v1/knowledge/about-me')).toBe(true);

  expect(allows('DELETE', '/api/v1/job-leads/42')).toBe(false);
  expect(allows('PATCH', '/api/v1/job-leads')).toBe(false);
  expect(allows('PATCH', '/api/v1/job-leads/42/x')).toBe(false);
  expect(allows('PATCH', '/api/v1/job-leads/abc')).toBe(false);
  expect(allows('GET', '/api/v1/job-leads/42')).toBe(false);
  expect(allows('PUT', '/api/v1/knowledge/priorities')).toBe(false);
  expect(allows('PUT', '/api/v1/knowledge/about-me')).toBe(false);
  expect(allows('GET', '/api/v1/knowledge')).toBe(false);
  expect(allows('GET', '/api/v1/applications')).toBe(false);
  expect(allows('POST', '/api/v1/applications')).toBe(false);
});

test('a full token may call anything under /api/v1', () => {
  expect(tokenAllows('full', 'GET', '/api/v1/knowledge/about-me')).toBe(true);
  expect(tokenAllows('full', 'DELETE', '/api/v1/applications/1')).toBe(true);
});

test('createApiToken stores the scope and defaults to full', () => {
  const user = createTestUser();
  const scoped = createApiToken(user.id, 'worker', 'job-leads:ingest');
  const plain = createApiToken(user.id, 'laptop');
  assert(scoped.ok && plain.ok);
  expect(getApiToken(scoped.token)?.scope).toBe('job-leads:ingest');
  expect(getApiToken(plain.token)?.scope).toBe('full');
  expect(getApiToken(plain.token)?.user.id).toBe(user.id);
  expect(getApiToken(plain.token)?.tokenName).toBe('laptop');
  expect(getApiToken('jat_unknown')).toBe(null);
  // created_at has 1 s precision, so the list order isn't stable here.
  expect(Object.fromEntries(listApiTokens(user.id).map((t) => [t.name, t.scope]))).toEqual({
    worker: 'job-leads:ingest',
    laptop: 'full',
  });
});

test('createApiToken rejects an unknown scope', () => {
  const user = createTestUser();
  const result = createApiToken(user.id, 'x', 'admin' as never);
  expect(result.ok).toBe(false);
  expect(!result.ok && result.status).toBe(400);
});

test('getApiToken still records last use', () => {
  const user = createTestUser();
  const created = createApiToken(user.id, 'used');
  assert(created.ok);
  expect(listApiTokens(user.id)[0].last_used_at).toBe(null);
  getApiToken(created.token);
  expect(listApiTokens(user.id)[0].last_used_at).not.toBe(null);
});

test('a token with an unknown stored scope is rejected', () => {
  const user = createTestUser();
  const created = createApiToken(user.id, 'tampered');
  assert(created.ok);
  db.prepare("UPDATE api_tokens SET scope = 'admin' WHERE user_id = ?").run(user.id);
  expect(getApiToken(created.token)).toBe(null);
  expect(tokenAllows('admin' as never, 'GET', '/api/v1/x')).toBe(false);
});

test('parseUserTokenScope gives regular users only full and radar', () => {
  expect(parseUserTokenScope(undefined, false)).toEqual({ ok: true, scope: 'full' });
  expect(parseUserTokenScope('full', false)).toEqual({ ok: true, scope: 'full' });
  expect(parseUserTokenScope('job-leads:radar', false)).toEqual({ ok: true, scope: 'job-leads:radar' });
  for (const bad of ['job-leads:ingest', 'inbound:deliver', 'admin', '', null, 42]) {
    expect(parseUserTokenScope(bad, false).ok).toBe(false);
  }
});

test('parseUserTokenScope lets admins create the worker scopes too', () => {
  for (const scope of ['full', 'job-leads:radar', 'job-leads:ingest', 'inbound:deliver']) {
    expect(parseUserTokenScope(scope, true)).toEqual({ ok: true, scope });
  }
  for (const bad of ['admin', '', null, 42]) {
    expect(parseUserTokenScope(bad, true).ok).toBe(false);
  }
});

test('isAdmin follows the role column, set only from the CLI', () => {
  const user = createTestUser();
  expect(isAdmin(user.id)).toBe(false);
  expect(setAdmin(user.username, true)).toBe(true);
  expect(isAdmin(user.id)).toBe(true);
  expect(setAdmin(user.username, false)).toBe(true);
  expect(isAdmin(user.id)).toBe(false);
  expect(setAdmin('no-such-user', true)).toBe(false);
  expect(isAdmin(999_999)).toBe(false);
});

test('the role column only accepts user and admin', () => {
  const user = createTestUser();
  expect(() => db.prepare("UPDATE users SET role = 'root' WHERE id = ?").run(user.id)).toThrow();
});

test('rotating a token replaces its secret but keeps name and scope', () => {
  const user = createTestUser();
  const created = createApiToken(user.id, 'worker', 'inbound:deliver');
  assert(created.ok);
  getApiToken(created.token);
  const rotated = rotateApiToken(user.id, 'worker');
  assert(rotated.ok);
  expect(rotated.token).not.toBe(created.token);
  expect(rotated.token.startsWith('jat_')).toBeTruthy();
  expect(getApiToken(created.token)).toBe(null);
  expect(getApiToken(rotated.token)?.scope).toBe('inbound:deliver');
  const tokens = listApiTokens(user.id);
  expect(tokens.length).toBe(1);
  expect(tokens[0].name).toBe('worker');
});

test('rotating resets last use', () => {
  const user = createTestUser();
  const created = createApiToken(user.id, 'used');
  assert(created.ok);
  getApiToken(created.token);
  expect(rotateApiToken(user.id, 'used').ok).toBeTruthy();
  expect(listApiTokens(user.id)[0].last_used_at).toBe(null);
});

test('rotating an unknown or foreign token fails and changes nothing', () => {
  const owner = createTestUser();
  const other = createTestUser();
  const created = createApiToken(owner.id, 'mine');
  assert(created.ok);
  expect(rotateApiToken(other.id, 'mine')).toEqual({ ok: false, status: 404, error: 'No such token.' });
  expect(rotateApiToken(owner.id, 'missing')).toEqual({ ok: false, status: 404, error: 'No such token.' });
  expect(getApiToken(created.token)?.user.id).toBe(owner.id);
});
