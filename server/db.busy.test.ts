import './test/env.ts';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { test } from 'node:test';
import { db } from './db.ts';

test('a write waits for another process to release its lock instead of failing', async () => {
  // Another process (like server/cli.ts) takes the write lock and holds it for 300 ms.
  const holder = spawn(
    process.execPath,
    [
      '--disable-warning=ExperimentalWarning',
      '-e',
      `const { DatabaseSync } = require('node:sqlite');
       const other = new DatabaseSync(process.env.DB_PATH);
       other.exec('BEGIN IMMEDIATE');
       console.log('locked');
       setTimeout(() => { other.exec('COMMIT'); other.close(); }, 300);`,
    ],
    { env: process.env },
  );
  await once(holder.stdout, 'data');

  const started = Date.now();
  db.prepare('INSERT INTO users (username, password_hash) VALUES (?, ?)').run('waited', 'x');
  assert.ok(Date.now() - started >= 200, 'the insert should have waited for the lock');
  assert.ok(db.prepare("SELECT 1 FROM users WHERE username = 'waited'").get());
  await once(holder, 'exit');
});
