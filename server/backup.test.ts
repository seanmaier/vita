// Runs server/backup.ts as the container does, against a throwaway database
// and backup directory.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, readdirSync, utimesSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { test } from 'node:test';

function setup() {
  const dir = mkdtempSync(join(tmpdir(), 'vita-backup-'));
  const dbPath = join(dir, 'app.db');
  const backupDir = join(dir, 'backups');
  mkdirSync(backupDir);
  const db = new DatabaseSync(dbPath);
  db.exec("CREATE TABLE users (id INTEGER PRIMARY KEY, username TEXT); INSERT INTO users (username) VALUES ('a');");
  db.close();
  const run = (...args: string[]) =>
    execFileSync(process.execPath, ['--disable-warning=ExperimentalWarning', 'server/backup.ts', ...args], {
      env: { ...process.env, DB_PATH: dbPath, BACKUP_DIR: backupDir },
      encoding: 'utf8',
    });
  return { dbPath, backupDir, run };
}

test('two backups right after each other are both kept, named with their time', () => {
  const { backupDir, run } = setup();
  run('create');
  run('create');
  const files = readdirSync(backupDir).sort();
  assert.equal(files.length, 2, files.join(', '));
  for (const file of files) assert.match(file, /^vita-\d{4}-\d{2}-\d{2}-\d{6}\.db$/);
});

test('backups named before timestamps are still listed, ordered and pruned', () => {
  const { backupDir, run } = setup();
  run('create');
  const [current] = readdirSync(backupDir);
  // A daily backup from the old naming scheme, from long ago.
  const legacy = 'vita-2020-01-01.db';
  copyFileSync(join(backupDir, current), join(backupDir, legacy));
  utimesSync(join(backupDir, legacy), new Date('2020-01-01'), new Date('2020-01-01'));
  const listed = run('list');
  assert.ok(listed.indexOf(legacy) < listed.indexOf(current), listed);
  run('create');
  assert.ok(!readdirSync(backupDir).includes(legacy), 'the old backup is pruned');
});

test('a legacy backup from today sorts before a timestamped one from today', () => {
  const { backupDir, run } = setup();
  run('create');
  const [current] = readdirSync(backupDir);
  const legacy = `${current.slice(0, 'vita-YYYY-MM-DD'.length)}.db`;
  copyFileSync(join(backupDir, current), join(backupDir, legacy));
  const lines = run('list').trim().split('\n');
  assert.ok(lines[0].startsWith(legacy) && lines[1].startsWith(current), lines.join('\n'));
});
