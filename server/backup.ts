// Database backups, run inside the container (deploy/vita-backup.sh wraps these):
//   node server/backup.ts create          snapshot of the live DB, prunes old backups
//   node server/backup.ts list
//   node server/backup.ts restore <file>  only while the app is stopped
//
// Deliberately doesn't import db.ts: opening the database there would create
// tables and WAL files in the very file a restore is about to replace.
import { copyFileSync, existsSync, mkdirSync, readdirSync, renameSync, rmSync, statSync } from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

const DB_PATH = process.env.DB_PATH ?? path.resolve('data', 'app.db');
const BACKUP_DIR = process.env.BACKUP_DIR ?? path.resolve('data', 'backups');
const KEEP_DAYS = Number(process.env.BACKUP_KEEP_DAYS ?? 7);

// vita-2026-11-16-030000.db (a snapshot, UTC) and
// vita-2026-11-16-pre-restore-031500.db (the state just before a restore).
// vita-2026-11-16.db is the older, date-only name: still listed, restored and
// pruned. Only files matching this are ever pruned.
const BACKUP_NAME = /^vita-(\d{4}-\d{2}-\d{2})(?:-(\d{6})|-pre-restore-(\d{6}))?\.db$/;

function fail(message: string): never {
  console.error(message);
  process.exit(1);
}

const today = () => new Date().toISOString().slice(0, 10);
const timeOfDay = () => new Date().toISOString().slice(11, 19).replaceAll(':', '');

function backups(): { name: string; date: string; size: number }[] {
  if (!existsSync(BACKUP_DIR)) return [];
  return readdirSync(BACKUP_DIR)
    .map((name) => ({ name, match: BACKUP_NAME.exec(name) }))
    .filter((b) => b.match)
    .map(({ name, match }) => ({
      name,
      date: match![1],
      // A date-only name predates timestamps, so it counts as the start of its day.
      order: `${match![1]}-${match![2] ?? match![3] ?? '000000'}`,
      size: statSync(path.join(BACKUP_DIR, name)).size,
    }))
    .sort((a, b) => a.order.localeCompare(b.order) || a.name.localeCompare(b.name))
    .map(({ name, date, size }) => ({ name, date, size }));
}

// VACUUM INTO writes a consistent snapshot, including writes still in the
// WAL, while the app keeps running. It refuses an existing target, so it goes
// to a temp file first, which also means a half-written backup never carries
// a backup's name.
function snapshot(target: string) {
  if (!existsSync(DB_PATH)) fail(`No database at ${DB_PATH}.`);
  mkdirSync(BACKUP_DIR, { recursive: true });
  const tmp = `${target}.tmp`;
  rmSync(tmp, { force: true });
  const source = new DatabaseSync(DB_PATH);
  try {
    source.prepare('VACUUM INTO ?').run(tmp);
  } finally {
    source.close();
  }
  checkDatabase(tmp);
  renameSync(tmp, target);
}

function checkDatabase(file: string) {
  const db = new DatabaseSync(file, { readOnly: true });
  try {
    const { quick_check } = db.prepare('PRAGMA quick_check').get() as { quick_check: string };
    if (quick_check !== 'ok') fail(`${path.basename(file)} is damaged: ${quick_check}`);
    if (!db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'users'").get()) {
      fail(`${path.basename(file)} is not a Vita database.`);
    }
  } catch (error) {
    fail(`${path.basename(file)} can't be read as a database: ${(error as Error).message}`);
  } finally {
    db.close();
  }
}

// Removes backups older than KEEP_DAYS, but never the newest one, so a cron
// that stopped running for a while doesn't end with no backup at all.
function prune() {
  const cutoff = new Date(Date.now() - KEEP_DAYS * 86_400_000).toISOString().slice(0, 10);
  const all = backups();
  for (const b of all.slice(0, -1)) {
    if (b.date > cutoff) continue;
    rmSync(path.join(BACKUP_DIR, b.name));
    console.log(`Removed ${b.name}`);
  }
}

function create() {
  // The time keeps a second backup on the same day (e.g. right before a deploy)
  // from replacing the nightly one.
  // Two runs within the same second wait for the next one instead of failing.
  let name = `vita-${today()}-${timeOfDay()}.db`;
  while (existsSync(path.join(BACKUP_DIR, name))) {
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 1000 - (Date.now() % 1000));
    name = `vita-${today()}-${timeOfDay()}.db`;
  }
  const target = path.join(BACKUP_DIR, name);
  snapshot(target);
  console.log(`Created ${name} (${formatSize(statSync(target).size)})`);
  prune();
}

function restore(file: string | undefined) {
  if (!file) fail('Usage: restore <file>   (a name from "list", or a path)');
  const source = path.isAbsolute(file) || file.includes('/') ? file : path.join(BACKUP_DIR, file);
  if (!existsSync(source)) fail(`No backup ${source}. See "list".`);
  checkDatabase(source);

  // Keep the current state, so a restore of the wrong day can be undone.
  if (existsSync(DB_PATH)) {
    const safety = `vita-${today()}-pre-restore-${timeOfDay()}.db`;
    snapshot(path.join(BACKUP_DIR, safety));
    console.log(`Saved the current database as ${safety}`);
  }

  // The WAL and its index belong to the old database; left in place, SQLite
  // would replay them onto the restored one.
  const tmp = `${DB_PATH}.restore`;
  copyFileSync(source, tmp);
  for (const suffix of ['-wal', '-shm']) rmSync(DB_PATH + suffix, { force: true });
  renameSync(tmp, DB_PATH);
  console.log(`Restored ${path.basename(source)}. Start the app again.`);
}

function list() {
  const all = backups();
  if (!all.length) console.log(`No backups in ${BACKUP_DIR}.`);
  for (const b of all) console.log(`${b.name}\t${formatSize(b.size)}`);
}

function formatSize(bytes: number) {
  return bytes < 1024 * 1024 ? `${(bytes / 1024).toFixed(0)} KB` : `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

const [command, arg] = process.argv.slice(2);
switch (command) {
  case 'create':
    create();
    break;
  case 'list':
    list();
    break;
  case 'restore':
    restore(arg);
    break;
  default:
    fail('Commands: create | list | restore <file>');
}
