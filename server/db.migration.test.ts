// Deliberately does not import ./test/env.ts: it needs a database created with
// the old api_tokens schema (no scope column) before server/db.ts opens it.
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { test } from 'node:test';

test('the scope migration keeps old tokens as full and is idempotent', async () => {
  const dbPath = join(mkdtempSync(join(tmpdir(), 'vita-migrate-')), 'app.db');
  const old = new DatabaseSync(dbPath);
  old.exec(`
    CREATE TABLE users (id INTEGER PRIMARY KEY, username TEXT NOT NULL UNIQUE COLLATE NOCASE,
      password_hash TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT (datetime('now')));
    CREATE TABLE api_tokens (id INTEGER PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      name TEXT NOT NULL, token_hash TEXT NOT NULL UNIQUE, created_at TEXT NOT NULL DEFAULT (datetime('now')),
      last_used_at TEXT, UNIQUE (user_id, name));
    INSERT INTO users (id, username, password_hash) VALUES (1, 'old', 'x');
    INSERT INTO api_tokens (user_id, name, token_hash) VALUES (1, 'legacy', 'h');
  `);
  old.close();

  process.env.DB_PATH = dbPath;
  const { db, migrate } = await import('./db.ts');
  const scopeOf = () => db.prepare("SELECT scope FROM api_tokens WHERE name = 'legacy'").get();
  assert.deepEqual({ ...scopeOf() }, { scope: 'full' });
  migrate();
  migrate();
  assert.deepEqual({ ...scopeOf() }, { scope: 'full' });
});
