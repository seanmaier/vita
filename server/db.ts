import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

const DB_PATH = process.env.DB_PATH ?? path.resolve('data', 'app.db');

mkdirSync(path.dirname(DB_PATH), { recursive: true });

export const db = new DatabaseSync(DB_PATH);

db.exec(`
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

  -- Mirrors the browser's former localStorage layout: one row per key, value
  -- kept as the exact string the frontend wrote, scoped per user.
  CREATE TABLE IF NOT EXISTS kv (
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    key     TEXT NOT NULL,
    value   TEXT NOT NULL,
    PRIMARY KEY (user_id, key)
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
    UNIQUE (user_id, source, external_id)
  );

  -- Each user's own alert address, and the mailbox they forward from.
  CREATE TABLE IF NOT EXISTS inbound_addresses (
    user_id         INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    local_part      TEXT NOT NULL UNIQUE,
    forwarding_from TEXT,
    created_at      TEXT NOT NULL DEFAULT (datetime('now'))
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
  const columns = db.prepare('PRAGMA table_info(api_tokens)').all() as { name: string }[];
  if (!columns.some((c) => c.name === 'scope')) {
    // What the token may call; tokens that predate scopes keep full access.
    db.exec("ALTER TABLE api_tokens ADD COLUMN scope TEXT NOT NULL DEFAULT 'full'");
  }
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
