// Deliberately does not import ./test/env.ts: it needs a database holding
// data from before status histories existed before server/db.ts opens it.
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { test } from 'node:test';

test('old statuses become seeded histories, once', async () => {
  const dbPath = join(mkdtempSync(join(tmpdir(), 'vita-migrate-status-')), 'app.db');
  const old = new DatabaseSync(dbPath);
  old.exec(`
    CREATE TABLE users (id INTEGER PRIMARY KEY, username TEXT NOT NULL UNIQUE COLLATE NOCASE,
      password_hash TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT (datetime('now')));
    CREATE TABLE kv (user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, key TEXT NOT NULL,
      value TEXT NOT NULL, PRIMARY KEY (user_id, key));
    INSERT INTO users (id, username, password_hash) VALUES (1, 'old', 'x');
  `);
  const put = old.prepare('INSERT INTO kv (user_id, key, value) VALUES (1, ?, ?)');
  put.run(
    'local-apps',
    JSON.stringify([
      { id: 'listed', company: 'A', role: 'R', status: 'sent', appliedDate: '01.10.2026' },
      { id: 'ghost', company: 'B', role: 'R', status: 'drafting' },
      { id: 'done', company: 'C', role: 'R', status: 'drafting' },
    ]),
  );
  put.run('status-ghost', 'ghosted');
  put.run('app-config-ghost', JSON.stringify({ id: 'ghost', company: 'B', role: 'R', appliedDate: '2026-09-01' }));
  put.run('status-bundled', 'interview');
  const kept = JSON.stringify([{ to: 'drafting', date: null, recordedAt: null }]);
  put.run('status-done', 'offer');
  put.run('status-history-done', kept);
  old.close();

  process.env.DB_PATH = dbPath;
  const { db, migrate } = await import('./db.ts');
  const history = (id: string) => {
    const row = db.prepare('SELECT value FROM kv WHERE user_id = 1 AND key = ?').get(`status-history-${id}`) as
      { value: string } | undefined;
    return row && (JSON.parse(row.value) as { to: string; date: string | null }[]).map((t) => [t.to, t.date]);
  };

  assert.deepEqual(history('listed'), [
    ['drafting', null],
    ['sent', '2026-10-01'],
  ]);
  assert.deepEqual(history('ghost'), [
    ['drafting', null],
    ['sent', '2026-09-01'],
  ]);
  assert.deepEqual(history('bundled'), [
    ['drafting', null],
    ['sent', null],
    ['interview', null],
  ]);
  assert.deepEqual(history('done'), [['drafting', null]]);
  // The old values stay for a rollback.
  assert.ok(db.prepare("SELECT 1 FROM kv WHERE key = 'status-ghost'").get());

  const before = db.prepare('SELECT key, value FROM kv ORDER BY key').all();
  migrate();
  assert.deepEqual(db.prepare('SELECT key, value FROM kv ORDER BY key').all(), before);
});
