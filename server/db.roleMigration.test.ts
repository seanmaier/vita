// Deliberately does not import ./test/env.ts: it needs a database created with
// the old users schema (no role column) before server/db.ts opens it.
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { test } from 'node:test';

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
  assert.deepEqual(roleOf(), { role: 'user' });
  migrate();
  migrate();
  assert.deepEqual(roleOf(), { role: 'user' });
  db.prepare("UPDATE users SET role = 'admin' WHERE id = 1").run();
  assert.throws(() => db.prepare("UPDATE users SET role = 'root' WHERE id = 1").run());
});
