// Deliberately does not import ./test/env.ts: it needs a database created with
// the old job_leads schema (no rating column) before server/db.ts opens it.
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { test } from 'node:test';

test('the rating migration adds the column, keeps old leads and is idempotent', async () => {
  const dbPath = join(mkdtempSync(join(tmpdir(), 'vita-migrate-')), 'app.db');
  const old = new DatabaseSync(dbPath);
  old.exec(`
    CREATE TABLE users (id INTEGER PRIMARY KEY, username TEXT NOT NULL UNIQUE COLLATE NOCASE,
      password_hash TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT (datetime('now')));
    CREATE TABLE job_leads (id INTEGER PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      source TEXT NOT NULL, external_id TEXT NOT NULL, title TEXT NOT NULL, company TEXT, location TEXT,
      url TEXT NOT NULL, received_at TEXT NOT NULL DEFAULT (datetime('now')),
      status TEXT NOT NULL DEFAULT 'new' CHECK (status IN ('new', 'rated', 'dismissed', 'applied')),
      score INTEGER CHECK (score BETWEEN 0 AND 100), verdict TEXT, rated_at TEXT, application_id TEXT,
      UNIQUE (user_id, source, external_id));
    INSERT INTO users (id, username, password_hash) VALUES (1, 'old', 'x');
    INSERT INTO job_leads (user_id, source, external_id, title, url, status, score, verdict)
      VALUES (1, 'linkedin', 'e1', 'Old job', 'https://example.com/1', 'rated', 71, 'Passt');
  `);
  old.close();

  process.env.DB_PATH = dbPath;
  const { db, migrate } = await import('./db.ts');
  migrate();
  migrate();
  const columns = (db.prepare('PRAGMA table_info(job_leads)').all() as { name: string }[]).map((c) => c.name);
  assert.ok(columns.includes('rating'));
  const row = db.prepare("SELECT score, verdict, rating FROM job_leads WHERE external_id = 'e1'").get();
  assert.deepEqual({ ...row }, { score: 71, verdict: 'Passt', rating: null });
});
