import { describe, expect, it } from 'vitest';
import { db } from './db.ts';
import { createTestUser } from './test/testApp.ts';
import { allValues, getValue, idsWithStoredKey, setValue } from './userData.ts';

const apps = [
  { id: 'acme', company: 'Acme', role: 'Dev', status: 'drafting' },
  { id: 'old', company: 'Old', role: 'Dev', status: 'sent', deletedAt: '2026-11-01T00:00:00.000Z' },
];
const history = [
  { to: 'drafting', date: null, recordedAt: null },
  { to: 'sent', date: '2026-11-10', recordedAt: '2026-11-10T09:00:00.000Z' },
];

describe('keys round-trip through the tables', () => {
  it.each([
    ['local-apps', JSON.stringify(apps)],
    [
      'base-profiles',
      JSON.stringify([{ id: 'default-en', name: 'English', language: 'en', profile: { name: 'Sam' } }]),
    ],
    ['app-config-acme', JSON.stringify({ id: 'acme', company: 'Acme GmbH', role: 'Dev' })],
    ['status-acme', 'interview'],
    ['status-history-acme', JSON.stringify(history)],
    ['profile-override-de', JSON.stringify({ name: 'Sam' })],
    ['knowledge-priorities', 'Remote first'],
    ['tour-seen', '1'],
  ])('%s', (key, value) => {
    const { id } = createTestUser();
    setValue(id, key, value);
    expect(getValue(id, key)).toBe(value);
    expect(allValues(id)).toEqual({ [key]: value });
    setValue(id, key, null);
    expect(getValue(id, key)).toBeNull();
    expect(allValues(id)).toEqual({});
  });
});

describe('lists', () => {
  it('stores one row per application, with its place and trash state visible to SQL', () => {
    const { id } = createTestUser();
    setValue(id, 'local-apps', JSON.stringify(apps));
    const rows = db
      .prepare('SELECT id, position, deleted_at FROM applications WHERE user_id = ? ORDER BY position')
      .all(id);
    expect(rows.map((r) => ({ ...r }))).toEqual([
      { id: 'acme', position: 0, deleted_at: null },
      { id: 'old', position: 1, deleted_at: '2026-11-01T00:00:00.000Z' },
    ]);
  });

  it('keeps saved edits and the legacy status when an application leaves the list, and drops empty rows', () => {
    const { id } = createTestUser();
    setValue(id, 'local-apps', JSON.stringify(apps));
    setValue(id, 'app-config-acme', '{"id":"acme"}');
    setValue(id, 'local-apps', JSON.stringify([]));
    expect(getValue(id, 'app-config-acme')).toBe('{"id":"acme"}');
    expect(
      db
        .prepare('SELECT id FROM applications WHERE user_id = ?')
        .all(id)
        .map((r) => r.id),
    ).toEqual(['acme']);
    setValue(id, 'app-config-acme', null);
    expect(db.prepare('SELECT 1 FROM applications WHERE user_id = ?').get(id)).toBeUndefined();
  });

  it('tells an empty list from none at all', () => {
    const { id } = createTestUser();
    expect(getValue(id, 'base-profiles')).toBeNull();
    setValue(id, 'base-profiles', '[]');
    expect(getValue(id, 'base-profiles')).toBe('[]');
    setValue(id, 'base-profiles', null);
    expect(getValue(id, 'base-profiles')).toBeNull();
  });

  it.each([
    ['corrupt JSON', '[{"id":'],
    ['not an array', '{"id":"x"}'],
    ['an entry without an id', '[{"company":"A"}]'],
    ['duplicate ids', '[{"id":"a"},{"id":"a"}]'],
  ])('keeps a list with %s as it is', (_, value) => {
    const { id } = createTestUser();
    setValue(id, 'local-apps', JSON.stringify(apps));
    setValue(id, 'local-apps', value);
    expect(getValue(id, 'local-apps')).toBe(value);
    expect(allValues(id)['local-apps']).toBe(value);
    // A valid list afterwards replaces it.
    setValue(id, 'local-apps', JSON.stringify(apps));
    expect(getValue(id, 'local-apps')).toBe(JSON.stringify(apps));
  });

  it('keeps an empty or broken status history as it is', () => {
    const { id } = createTestUser();
    setValue(id, 'status-history-x', '[]');
    expect(getValue(id, 'status-history-x')).toBe('[]');
    setValue(id, 'status-history-x', 'oops');
    expect(getValue(id, 'status-history-x')).toBe('oops');
  });
});

it('lists ids per key prefix, telling status-<id> from status-history-<id>', () => {
  const { id } = createTestUser();
  setValue(id, 'status-a', 'sent');
  setValue(id, 'status-history-b', JSON.stringify(history));
  setValue(id, 'app-config-c', '{}');
  expect(idsWithStoredKey(id, 'status-')).toEqual(['a']);
  expect(idsWithStoredKey(id, 'status-history-')).toEqual(['b']);
  expect(idsWithStoredKey(id, 'app-config-')).toEqual(['c']);
});

it('keeps users apart and removes everything with the user', () => {
  const a = createTestUser();
  const b = createTestUser();
  setValue(a.id, 'local-apps', JSON.stringify(apps));
  setValue(a.id, 'status-history-acme', JSON.stringify(history));
  setValue(a.id, 'tour-seen', '1');
  expect(allValues(b.id)).toEqual({});
  db.prepare('DELETE FROM users WHERE id = ?').run(a.id);
  for (const table of ['applications', 'status_transitions', 'stored_lists', 'user_settings']) {
    expect(db.prepare(`SELECT 1 FROM ${table} WHERE user_id = ?`).get(a.id)).toBeUndefined();
  }
});
