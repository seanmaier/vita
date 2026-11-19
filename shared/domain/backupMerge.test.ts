import { assert, expect, test } from 'vitest';
import type { ApplicationConfig, BaseProfile } from '#shared/types.ts';
import { mergeBackup, parseBackup, type DataBackup } from '#shared/domain/backupMerge.ts';

const app = (id: string, extra: Partial<ApplicationConfig> = {}): ApplicationConfig => ({
  id,
  company: id,
  role: 'Dev',
  status: 'drafting',
  ...extra,
});
const profile = (id: string) => ({ id, name: id, language: 'en', profile: {} }) as unknown as BaseProfile;

function backup(extra: Partial<DataBackup> = {}): DataBackup {
  return {
    version: 3,
    exportedAt: '2026-11-16T00:00:00.000Z',
    localApps: [],
    statusHistories: {},
    configOverrides: {},
    profileOverrides: {},
    ...extra,
  };
}

test('new applications are added with their history, existing ones are skipped untouched', () => {
  const current = {
    'local-apps': JSON.stringify([app('kept', { role: 'Current' })]),
    'status-only': 'sent',
    'status-history-hist': '[]',
    'app-config-over': '{}',
  };
  const history = [
    { to: 'drafting', date: null, recordedAt: null },
    { to: 'sent', date: '2026-11-01', recordedAt: null },
  ];
  const result = mergeBackup(
    current,
    backup({
      localApps: [app('kept', { role: 'From backup' }), app('new'), app('only'), app('hist'), app('over')],
      statusHistories: {
        new: history as DataBackup['statusHistories'][string],
        kept: history as DataBackup['statusHistories'][string],
      },
      configOverrides: {
        new: { id: 'new', company: 'New', role: 'Dev' },
        kept: { id: 'kept', company: 'X', role: 'Y' },
      },
    }),
  );
  assert(result.ok);
  expect(result.added).toEqual(['new']);
  expect(result.skipped.sort()).toEqual(['hist', 'kept', 'only', 'over']);
  const list = JSON.parse(result.set['local-apps']) as ApplicationConfig[];
  expect(list.map((a) => [a.id, a.role])).toEqual([
    ['kept', 'Current'],
    ['new', 'Dev'],
  ]);
  expect(JSON.parse(result.set['status-history-new'])).toEqual(history);
  expect(result.set['app-config-new']).toBeTruthy();
  expect(result.set['app-config-kept']).toBe(undefined);
  expect(result.set['status-history-kept']).toBe(undefined);
});

test('a version-2 backup gets its histories seeded from status and dates', () => {
  const parsed = parseBackup(
    JSON.stringify({
      version: 2,
      exportedAt: 'x',
      localApps: [app('a', { appliedDate: '01.10.2026' })],
      statuses: { a: 'rejected' },
      configOverrides: {},
      profileOverrides: {},
    }),
  );
  assert(parsed.ok);
  const result = mergeBackup({}, parsed.backup);
  assert(result.ok);
  const history = JSON.parse(result.set['status-history-a']) as { to: string; date: string | null }[];
  expect(history.map((t) => [t.to, t.date])).toEqual([
    ['drafting', null],
    ['sent', '2026-10-01'],
    ['rejected', null],
  ]);
});

test('an impossible history fails the whole import', () => {
  const result = mergeBackup(
    {},
    backup({
      localApps: [app('a')],
      statusHistories: {
        a: [
          { to: 'drafting', date: null, recordedAt: null },
          { to: 'accepted', date: null, recordedAt: null },
        ],
      },
    }),
  );
  expect(result.ok).toBe(false);
  if (!result.ok) expect(result.error).toMatch(/"a"/);
});

test('base profiles are added when new; the list is created when there is none', () => {
  const merged = mergeBackup(
    { 'base-profiles': JSON.stringify([profile('mine')]) },
    backup({ baseProfiles: [profile('mine'), profile('other')] }),
  );
  assert(merged.ok);
  expect(merged.addedProfiles).toEqual(['other']);
  expect((JSON.parse(merged.set['base-profiles']) as BaseProfile[]).map((p) => p.id)).toEqual(['mine', 'other']);

  const fresh = mergeBackup({}, backup({ baseProfiles: [profile('a')] }));
  assert(fresh.ok);
  expect(fresh.addedProfiles).toEqual(['a']);
});

test('legacy profile overrides are only filled in where none exist', () => {
  const result = mergeBackup(
    { 'profile-override-en': '{"mine":true}' },
    backup({
      profileOverrides: { en: { theirs: true } as never, de: { theirs: true } as never },
    }),
  );
  assert(result.ok);
  expect(result.set['profile-override-en']).toBe(undefined);
  expect(result.set['profile-override-de']).toBeTruthy();
});

test('parsing rejects files that are not backups', () => {
  expect(parseBackup('nope').ok).toBe(false);
  expect(parseBackup('{}').ok).toBe(false);
  expect(parseBackup(JSON.stringify({ localApps: [], configOverrides: {}, profileOverrides: {} })).ok).toBe(false);
});
