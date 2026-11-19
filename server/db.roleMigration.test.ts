// Points DB_PATH elsewhere than the setup file (server/test/env.ts) did and
// imports server/db.ts only then: it needs a database created with
// the old users schema (no role column) before server/db.ts opens it.
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { expect, test } from 'vitest';

test('the role migration makes existing users regular users and is idempotent', async () => {
  const dbPath = join(mkdtempSync(join(tmpdir(), 'vita-migrate-role-')), 'app.db');
  const old = new DatabaseSync(dbPath);
  old.exec(`
    CREATE TABLE users (id INTEGER PRIMARY KEY, username TEXT NOT NULL UNIQUE COLLATE NOCASE,
      password_hash TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT (datetime('now')));
    INSERT INTO users (id, username, password_hash) VALUES (1, 'old', 'x');
  `);
  old.close();

  process.env.DB_PATH = dbPath;
  const { db, migrate } = await import('./db.ts');
  const roleOf = () => ({ ...db.prepare('SELECT role FROM users WHERE id = 1').get() });
  expect(roleOf()).toEqual({ role: 'user' });
  migrate();
  migrate();
  expect(roleOf()).toEqual({ role: 'user' });
  db.prepare("UPDATE users SET role = 'admin' WHERE id = 1").run();
  expect(() => db.prepare("UPDATE users SET role = 'root' WHERE id = 1").run()).toThrow();
});
