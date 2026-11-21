import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { seedHistory } from '#shared/domain/statusMachine.ts';
import type { ApplicationConfig, ApplicationStatus } from '#shared/types.ts';
import { log } from './log.ts';

const DB_PATH = process.env.DB_PATH ?? path.resolve('data', 'app.db');

mkdirSync(path.dirname(DB_PATH), { recursive: true });

export const db = new DatabaseSync(DB_PATH);

db.exec(`
  -- Other processes write to the same file (server/cli.ts in the container,
  -- the backup script): wait up to 5 s for their lock instead of failing at once
  -- with SQLITE_BUSY. First, so even switching to WAL below waits.
  PRAGMA busy_timeout = 5000;
  PRAGMA journal_mode = WAL;
  PRAGMA foreign_keys = ON;

  CREATE TABLE IF NOT EXISTS users (
    id            INTEGER PRIMARY KEY,
    username      TEXT NOT NULL UNIQUE COLLATE NOCASE,
    password_hash TEXT NOT NULL,
    created_at    TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS sessions (
    token_hash TEXT PRIMARY KEY,
    user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    expires_at INTEGER NOT NULL
  );

  -- Long-lived bearer tokens for scripts and assistants calling /api/v1.
  -- Like sessions, only the hash is stored; the token is shown once on creation.
  CREATE TABLE IF NOT EXISTS api_tokens (
    id           INTEGER PRIMARY KEY,
    user_id      INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name         TEXT NOT NULL,
    token_hash   TEXT NOT NULL UNIQUE,
    created_at   TEXT NOT NULL DEFAULT (datetime('now')),
    last_used_at TEXT,
    UNIQUE (user_id, name)
  );

  -- Job postings collected from alerts (email worker, scripts), rated later.
  CREATE TABLE IF NOT EXISTS job_leads (
    id             INTEGER PRIMARY KEY,
    user_id        INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    source         TEXT NOT NULL,
    external_id    TEXT NOT NULL,
    title          TEXT NOT NULL,
    company        TEXT,
    location       TEXT,
    url            TEXT NOT NULL,
    received_at    TEXT NOT NULL DEFAULT (datetime('now')),
    status         TEXT NOT NULL DEFAULT 'new' CHECK (status IN ('new', 'rated', 'dismissed', 'applied')),
    score          INTEGER CHECK (score BETWEEN 0 AND 100),
    verdict        TEXT,
    rated_at       TEXT,
    application_id TEXT,
    rating         TEXT,
    snippet        TEXT,
    UNIQUE (user_id, source, external_id)
  );

  -- Each user's own alert address, and the mailbox they forward from.
  CREATE TABLE IF NOT EXISTS inbound_addresses (
    user_id         INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    local_part      TEXT NOT NULL UNIQUE,
    forwarding_from TEXT,
    created_at      TEXT NOT NULL DEFAULT (datetime('now'))
  );
  -- Facts about the database itself, e.g. when a one-off migration ran.
  CREATE TABLE IF NOT EXISTS meta (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS inbound_events (
    id           INTEGER PRIMARY KEY,
    user_id      INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    kind         TEXT NOT NULL CHECK (kind IN ('confirmation', 'failed', 'leads')),
    received_at  TEXT NOT NULL DEFAULT (datetime('now')),
    subject      TEXT,
    sender       TEXT,
    detail       TEXT
  );
`);

/**
 * Schema changes for databases created by older versions. Idempotent: safe to
 * run on every start and on a production database.
 */
export function migrate(): void {
  // What the token may call; tokens that predate scopes keep full access.
  addColumn('api_tokens', 'scope', "TEXT NOT NULL DEFAULT 'full'");
  // The criteria breakdown of a rating; leads rated before it stay without one.
  addColumn('job_leads', 'rating', 'TEXT');
  // What the alert said beyond title, company and location; older leads have none.
  addColumn('job_leads', 'snippet', 'TEXT');
  // Admins may create the worker token scopes. Everyone who predates roles is a
  // regular user; admins are made only with the CLI (server/cli.ts admin).
  addColumn('users', 'role', "TEXT NOT NULL DEFAULT 'user' CHECK (role IN ('user', 'admin'))");
  // Works on the kv rows of a database from before tables (see server/data/migrate.ts).
  if (hasKvTable() && !db.prepare("SELECT 1 FROM meta WHERE key = 'kv_moved_at'").get()) migrateStatusHistories();
}

/** Whether the database still has the kv table: one from before tables, e.g. an old backup restored. */
export function hasKvTable(): boolean {
  return db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'kv'").get() !== undefined;
}

/**
 * Adds a column an older database lacks and logs it, so a deploy that changed
 * the schema shows up in the log. Names are constants from migrate(), never input.
 */
function addColumn(table: string, column: string, definition: string): void {
  const columns = db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[];
  if (columns.some((c) => c.name === column)) return;
  db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  log.info('Migration applied', { table, column });
}

function parseJsonValue<T>(raw: string | undefined): T | null {
  if (raw === undefined) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

/**
 * Gives every application the server knows a status history (kv
 * `status-history-<id>`), seeded from its old `status-<id>` value and date
 * fields; a stored "ghosted" becomes "sent", since ghosted is now derived.
 * Applications that already have a history are left alone.
 */
function migrateStatusHistories(): void {
  const rows = db.prepare('SELECT user_id, key, value FROM kv').all() as {
    user_id: number;
    key: string;
    value: string;
  }[];
  const byUser = new Map<number, Map<string, string>>();
  for (const row of rows) {
    if (!byUser.has(row.user_id)) byUser.set(row.user_id, new Map());
    byUser.get(row.user_id)!.set(row.key, row.value);
  }
  const insert = db.prepare('INSERT OR IGNORE INTO kv (user_id, key, value) VALUES (?, ?, ?)');
  let seeded = 0;
  transaction(() => {
    for (const [userId, kv] of byUser) {
      const list = parseJsonValue<ApplicationConfig[]>(kv.get('local-apps')) ?? [];
      const ids = new Set([
        ...list.map((a) => a.id),
        ...[...kv.keys()]
          .filter((k) => k.startsWith('status-') && !k.startsWith('status-history-'))
          .map((k) => k.slice('status-'.length)),
      ]);
      for (const id of ids) {
        if (kv.has(`status-history-${id}`)) continue;
        const base = list.find((a) => a.id === id);
        const status = (kv.get(`status-${id}`) as ApplicationStatus | undefined) ?? base?.status ?? 'drafting';
        const dates = parseJsonValue<Partial<ApplicationConfig>>(kv.get(`app-config-${id}`)) ?? base ?? {};
        insert.run(userId, `status-history-${id}`, JSON.stringify(seedHistory(status, dates)));
        seeded++;
      }
    }
  });
  if (seeded) log.info('Migration applied', { migration: 'status-histories', rows: seeded });
}

migrate();

export function transaction<T>(fn: () => T): T {
  db.exec('BEGIN');
  try {
    const result = fn();
    db.exec('COMMIT');
    return result;
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
}
