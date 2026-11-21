// Points DB_PATH elsewhere than the setup file (server/test/env.ts) did and
// imports server/db.ts and server/userData.ts only then: it needs a database
// in the old format, with all data in kv rows, before they open it.
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { expect, test } from 'vitest';

const history = JSON.stringify([
  { to: 'drafting', date: null, recordedAt: null },
  { to: 'sent', date: '2026-11-10', recordedAt: '2026-11-10T09:00:00.000Z' },
]);

// Every kind of key, plus the awkward cases a long-lived account collects.
const user1: Record<string, string> = {
  'local-apps': JSON.stringify([
    { id: 'acme', company: 'Acme', role: 'Dev', status: 'drafting', language: 'de' },
    { id: 'trashed', company: 'Gone', role: 'Dev', status: 'sent', deletedAt: '2026-11-15T10:00:00.000Z' },
  ]),
  'base-profiles': JSON.stringify([
    { id: 'default-en', name: 'English (default)', language: 'en', profile: { name: 'Sam' } },
  ]),
  'app-config-acme': JSON.stringify({ id: 'acme', company: 'Acme GmbH', role: 'Dev', summaryOverride: 'Ü ß' }),
  'app-config-bundled': JSON.stringify({ id: 'bundled', company: 'From a file', role: 'Dev' }),
  'status-history-acme': history,
  'status-history-trashed': history,
  'profile-override-de': JSON.stringify({ name: 'Sam', role: 'Entwickler' }),
  'knowledge-priorities': '# Priorities\n\nRemote first',
  'tour-seen': '1',
  'some-future-key': 'kept as it is',
};
// No base profiles at all (the app seeds them on first open), a broken list.
const user2: Record<string, string> = {
  'local-apps': '[{"id":"a"},{"id":"a"}]',
  'status-history-a': history,
};

test('every kv row moves into the tables and reads back the same, then the kv table goes', async () => {
  const dbPath = join(mkdtempSync(join(tmpdir(), 'vita-move-kv-')), 'app.db');
  const old = new DatabaseSync(dbPath);
  old.exec(`
    CREATE TABLE users (id INTEGER PRIMARY KEY, username TEXT NOT NULL UNIQUE COLLATE NOCASE,
      password_hash TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT (datetime('now')));
    CREATE TABLE kv (user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, key TEXT NOT NULL,
      value TEXT NOT NULL, PRIMARY KEY (user_id, key));
    INSERT INTO users (id, username, password_hash) VALUES (1, 'one', 'x'), (2, 'two', 'x'), (3, 'three', 'x');
  `);
  const put = old.prepare('INSERT INTO kv (user_id, key, value) VALUES (?, ?, ?)');
  for (const [key, value] of Object.entries(user1)) put.run(1, key, value);
  for (const [key, value] of Object.entries(user2)) put.run(2, key, value);
  // From before status histories: the old migration in db.ts seeds one first.
  put.run(3, 'local-apps', JSON.stringify([{ id: 'legacy', company: 'L', role: 'R', status: 'sent' }]));
  put.run(3, 'status-legacy', 'interview');
  old.close();

  process.env.DB_PATH = dbPath;
  const { db } = await import('./db.ts');
  const { allValues, getValue, moveKvToTables, setValue } = await import('./userData.ts');

  expect(allValues(1)).toEqual(user1);
  expect(allValues(2)).toEqual(user2);
  expect(getValue(2, 'base-profiles')).toBeNull();
  expect(getValue(3, 'status-legacy')).toBe('interview');
  expect(JSON.parse(getValue(3, 'status-history-legacy')!)).toEqual([
    { to: 'drafting', date: null, recordedAt: null },
    { to: 'sent', date: null, recordedAt: null },
    { to: 'interview', date: null, recordedAt: null },
  ]);
  // Rows SQL can work with now, e.g. the trash.
  expect({ ...db.prepare("SELECT deleted_at FROM applications WHERE user_id = 1 AND id = 'trashed'").get() }).toEqual({
    deleted_at: '2026-11-15T10:00:00.000Z',
  });

  expect(db.prepare("SELECT name FROM sqlite_master WHERE name = 'kv'").get()).toBeUndefined();
  expect(db.prepare("SELECT 1 FROM meta WHERE key = 'kv_moved_at'").get()).toBeTruthy();

  // Once only: later changes in the tables survive another start.
  setValue(1, 'tour-seen', '2');
  moveKvToTables();
  expect(getValue(1, 'tour-seen')).toBe('2');

  // A database the previous release already moved (its kv rows kept for a
  // rollback) only loses the table; the stale rows don't overwrite anything.
  db.exec('CREATE TABLE kv (user_id INTEGER NOT NULL, key TEXT NOT NULL, value TEXT NOT NULL)');
  db.prepare("INSERT INTO kv (user_id, key, value) VALUES (1, 'tour-seen', 'stale')").run();
  moveKvToTables();
  expect(getValue(1, 'tour-seen')).toBe('2');
  expect(db.prepare("SELECT name FROM sqlite_master WHERE name = 'kv'").get()).toBeUndefined();
});
