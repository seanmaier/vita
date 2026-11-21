// The tables that hold each user's data. Every module in this folder works
// on its own tables; ./legacyKeys.ts maps the old storage keys onto them for
// data that still arrives in that format (old databases, backup files).
//
// The plan behind this: docs/superpowers/specs/2026-11-19-kv-to-tables-design.md.
import { db } from '../db.ts';

db.exec(`
  -- One row per application the user has: its entry in their list (config,
  -- with its place in the list), its saved edits (app-config-<id>) and, for
  -- data from before status histories, its single stored status
  -- (status-<id>). A row may have any of these without the others.
  CREATE TABLE IF NOT EXISTS applications (
    user_id       INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    id            TEXT NOT NULL,
    position      INTEGER,
    config        TEXT,
    saved_edits   TEXT,
    legacy_status TEXT,
    deleted_at    TEXT GENERATED ALWAYS AS (json_extract(config, '$.deletedAt')) VIRTUAL,
    PRIMARY KEY (user_id, id)
  );

  -- An application's status history (status-history-<id>), one step per row.
  -- Not tied to an applications row: a status can be recorded before the
  -- browser has saved the application itself.
  CREATE TABLE IF NOT EXISTS status_transitions (
    user_id   INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    app_id    TEXT NOT NULL,
    position  INTEGER NOT NULL,
    entry     TEXT NOT NULL,
    to_status TEXT GENERATED ALWAYS AS (json_extract(entry, '$.to')) VIRTUAL,
    PRIMARY KEY (user_id, app_id, position)
  );

  CREATE TABLE IF NOT EXISTS base_profiles (
    user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    id         TEXT NOT NULL,
    position   INTEGER NOT NULL,
    data       TEXT NOT NULL,
    name       TEXT GENERATED ALWAYS AS (json_extract(data, '$.name')) VIRTUAL,
    language   TEXT GENERATED ALWAYS AS (json_extract(data, '$.language')) VIRTUAL,
    deleted_at TEXT GENERATED ALWAYS AS (json_extract(data, '$.deletedAt')) VIRTUAL,
    PRIMARY KEY (user_id, id)
  );

  -- Edits to a language's default profile (profile-override-<language>).
  CREATE TABLE IF NOT EXISTS profile_overrides (
    user_id  INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    language TEXT NOT NULL,
    profile  TEXT NOT NULL,
    PRIMARY KEY (user_id, language)
  );

  CREATE TABLE IF NOT EXISTS knowledge_docs (
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    doc     TEXT NOT NULL,
    content TEXT NOT NULL,
    PRIMARY KEY (user_id, doc)
  );

  -- Which whole lists the user has stored, so an empty list and none at all
  -- stay apart: without base profiles the app seeds them from the language
  -- defaults the first time it opens. (Only 'base-profiles' is still read.)
  CREATE TABLE IF NOT EXISTS stored_lists (
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    list    TEXT NOT NULL,
    PRIMARY KEY (user_id, list)
  );

  -- Account settings (e.g. tour-seen), and old values that couldn't be read
  -- when they were moved in, kept as unreadable:<key> (see ./legacyKeys.ts).
  CREATE TABLE IF NOT EXISTS user_settings (
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    key     TEXT NOT NULL,
    value   TEXT NOT NULL,
    PRIMARY KEY (user_id, key)
  );
`);

/** Runs `fn` atomically, also when called inside an open transaction. */
export function atomic<T>(fn: () => T): T {
  db.exec('SAVEPOINT user_data');
  try {
    const result = fn();
    db.exec('RELEASE user_data');
    return result;
  } catch (e) {
    db.exec('ROLLBACK TO user_data');
    db.exec('RELEASE user_data');
    throw e;
  }
}
