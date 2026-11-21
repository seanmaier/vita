// Points DB_PATH elsewhere than the setup file (server/test/env.ts) did and
// imports server/db.ts only then: it needs a database created with
// the old api_tokens schema (no scope column) before server/db.ts opens it.
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { expect, test, vi } from 'vitest';

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
  expect({ ...scopeOf() }).toEqual({ scope: 'full' });
  migrate();
  migrate();
  expect({ ...scopeOf() }).toEqual({ scope: 'full' });
});

test('each applied migration is logged once, and a migrated database starts silently', async () => {
  const dbPath = join(mkdtempSync(join(tmpdir(), 'vita-migrate-log-')), 'app.db');
  const old = new DatabaseSync(dbPath);
  old.exec(`
    CREATE TABLE api_tokens (id INTEGER PRIMARY KEY, user_id INTEGER NOT NULL, name TEXT NOT NULL,
      token_hash TEXT NOT NULL UNIQUE, created_at TEXT NOT NULL DEFAULT (datetime('now')), last_used_at TEXT);
  `);
  old.close();

  const lines: string[] = [];
  vi.spyOn(process.stdout, 'write').mockImplementation((chunk) => {
    lines.push(String(chunk));
    return true;
  });
  vi.resetModules();
  process.env.DB_PATH = dbPath;
  const { migrate } = await import('./db.ts');
  const applied = () => lines.filter((line) => line.includes('msg="Migration applied"'));
  expect(applied().some((line) => / table=api_tokens column=scope\n$/.test(line))).toBe(true);

  const count = applied().length;
  migrate();
  expect(applied()).toHaveLength(count);
  vi.restoreAllMocks();
});
