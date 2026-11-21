import { describe, expect, it } from 'vitest';
import { db } from '../db.ts';
import { createTestUser } from '../test/testApp.ts';
import {
  applicationIdsWithData,
  applicationList,
  saveApplicationList,
  savedEdits,
  setLegacyStatus,
  setSavedEdits,
} from './applications.ts';
import { baseProfileList, saveBaseProfileList } from './baseProfiles.ts';
import { setting, setSetting } from './documents.ts';
import { legacyView, unreadableKey, writeLegacyValue } from './legacyKeys.ts';
import { splitKeptValues } from './migrate.ts';
import { recordedSteps, saveSteps } from './statusTransitions.ts';
import type { ApplicationConfig } from '#shared/types.ts';

const apps = [
  { id: 'acme', company: 'Acme', role: 'Dev', status: 'drafting' },
  { id: 'old', company: 'Old', role: 'Dev', status: 'sent', deletedAt: '2026-11-01T00:00:00.000Z' },
] as ApplicationConfig[];
const history = [
  { to: 'drafting', date: null, recordedAt: null },
  { to: 'sent', date: '2026-11-10', recordedAt: '2026-11-10T09:00:00.000Z' },
];

describe('applications', () => {
  it('stores one row per entry, with its place and trash state visible to SQL', () => {
    const { id } = createTestUser();
    saveApplicationList(id, apps);
    expect(applicationList(id)).toEqual(apps);
    const rows = db
      .prepare('SELECT id, position, deleted_at FROM applications WHERE user_id = ? ORDER BY position')
      .all(id);
    expect(rows.map((r) => ({ ...r }))).toEqual([
      { id: 'acme', position: 0, deleted_at: null },
      { id: 'old', position: 1, deleted_at: '2026-11-01T00:00:00.000Z' },
    ]);
  });

  it('keeps saved edits when an application leaves the list, and drops rows that hold nothing', () => {
    const { id } = createTestUser();
    saveApplicationList(id, apps);
    setSavedEdits(id, 'acme', { id: 'acme', company: 'Acme GmbH', role: 'Dev' });
    saveApplicationList(id, []);
    expect(savedEdits(id, 'acme')).toMatchObject({ company: 'Acme GmbH' });
    setSavedEdits(id, 'acme', null);
    expect(db.prepare('SELECT 1 FROM applications WHERE user_id = ?').get(id)).toBeUndefined();
  });

  it('lists the ids with edits, a legacy status or a history, listed or not', () => {
    const { id } = createTestUser();
    saveApplicationList(id, apps);
    setLegacyStatus(id, 'a', 'sent');
    saveSteps(id, 'b', history);
    setSavedEdits(id, 'c', { id: 'c', company: 'C', role: 'R' });
    expect(applicationIdsWithData(id)).toEqual(['a', 'b', 'c']);
  });
});

it('tells an empty list of base profiles from none at all', () => {
  const { id } = createTestUser();
  expect(baseProfileList(id)).toBeNull();
  saveBaseProfileList(id, []);
  expect(baseProfileList(id)).toEqual([]);
});

describe('old storage keys', () => {
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
  ])('%s reads back the same', (key, value) => {
    const { id } = createTestUser();
    writeLegacyValue(id, key, value);
    expect(legacyView(id)[key]).toBe(value);
  });

  it('keeps knowledge documents and settings', () => {
    const { id } = createTestUser();
    writeLegacyValue(id, 'knowledge-priorities', 'Remote first');
    writeLegacyValue(id, 'tour-seen', '1');
    expect(db.prepare('SELECT content FROM knowledge_docs WHERE user_id = ?').get(id)).toEqual({
      content: 'Remote first',
    });
    expect(setting(id, 'tour-seen')).toBe('1');
  });

  it.each([
    ['corrupt JSON', '[{"id":', []],
    ['not an array', '{"id":"x"}', []],
    ['an entry without an id', '[{"id":"a"},{"company":"A"}]', ['a']],
    ['duplicate ids', '[{"id":"a"},{"id":"a","company":"second"}]', ['a']],
  ])('splits a list with %s as far as it can and keeps the original', (_, value, ids) => {
    const { id } = createTestUser();
    writeLegacyValue(id, 'local-apps', value);
    expect(applicationList(id).map((a) => a.id)).toEqual(ids);
    expect(setting(id, unreadableKey('local-apps'))).toBe(value);
  });

  it('keeps an empty or broken status history aside', () => {
    const { id } = createTestUser();
    writeLegacyValue(id, 'status-history-x', '[]');
    expect(recordedSteps(id, 'x')).toBeNull();
    expect(setting(id, unreadableKey('status-history-x'))).toBe('[]');
  });
});

it('splits the values the first move kept as they were', () => {
  const { id } = createTestUser();
  setSetting(id, 'local-apps', '[{"id":"a"},{"id":"a"}]');
  setSetting(id, 'status-history-a', JSON.stringify(history));
  setSetting(id, 'base-profiles', 'oops');
  splitKeptValues();
  expect(applicationList(id).map((a) => a.id)).toEqual(['a']);
  expect(recordedSteps(id, 'a')).toEqual(history);
  expect(setting(id, 'local-apps')).toBeNull();
  expect(setting(id, unreadableKey('local-apps'))).toBe('[{"id":"a"},{"id":"a"}]');
  expect(setting(id, unreadableKey('base-profiles'))).toBe('oops');
  expect(setting(id, 'status-history-a')).toBeNull();
});
