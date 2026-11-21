// Each user's stored data, in tables. Server code still names values by their
// former storage keys (local-apps, app-config-<id>, status-history-<id>, …;
// see shared/storageKeys.ts), so this module maps every key to rows and back:
// reading a key returns exactly what was last written to it. Code that works
// with a key goes through server/store.ts, which uses these functions. Backup
// files use the same keys.
//
// Lists (applications, base profiles, a status history) become one row per
// entry, so SQL can see ids, order and trash state. A value that can't be
// split into rows (corrupt JSON, duplicate or missing ids) is kept as it is in
// user_settings, the same place as keys without a table of their own, so
// nothing written is ever lost.
//
// The plan behind this: docs/superpowers/specs/2026-11-19-kv-to-tables-design.md.
import { KEY_PREFIXES, STORAGE_KEYS } from '#shared/storageKeys.ts';
import { db, hasKvTable } from './db.ts';

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

  -- Which whole lists (local-apps, base-profiles) the user has stored, so an
  -- empty list and none at all stay apart: without base profiles the app
  -- seeds them from the language defaults the first time it opens.
  CREATE TABLE IF NOT EXISTS stored_lists (
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    list    TEXT NOT NULL,
    PRIMARY KEY (user_id, list)
  );

  -- Every other key (e.g. tour-seen), and values kept as they are (see above).
  CREATE TABLE IF NOT EXISTS user_settings (
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    key     TEXT NOT NULL,
    value   TEXT NOT NULL,
    PRIMARY KEY (user_id, key)
  );
`);

// ---- Keys -------------------------------------------------------------------

type Key =
  | { kind: 'localApps' }
  | { kind: 'baseProfiles' }
  | { kind: 'appConfig'; id: string }
  | { kind: 'status'; id: string }
  | { kind: 'statusHistory'; id: string }
  | { kind: 'profileOverride'; language: string }
  | { kind: 'knowledge'; doc: string }
  | { kind: 'setting' };

function parseKey(key: string): Key {
  if (key === STORAGE_KEYS.localApps) return { kind: 'localApps' };
  if (key === STORAGE_KEYS.baseProfiles) return { kind: 'baseProfiles' };
  const rest = (prefix: string) =>
    key.startsWith(prefix) && key.length > prefix.length ? key.slice(prefix.length) : null;
  // status-history- first: it also starts with status-.
  const historyId = rest(KEY_PREFIXES.statusHistory);
  if (historyId !== null) return { kind: 'statusHistory', id: historyId };
  const configId = rest(KEY_PREFIXES.appConfig);
  if (configId !== null) return { kind: 'appConfig', id: configId };
  const statusId = rest(KEY_PREFIXES.status);
  if (statusId !== null) return { kind: 'status', id: statusId };
  const language = rest(KEY_PREFIXES.profileOverride);
  if (language !== null) return { kind: 'profileOverride', language };
  const doc = rest(KEY_PREFIXES.knowledge);
  if (doc !== null) return { kind: 'knowledge', doc };
  return { kind: 'setting' };
}

/** Runs `fn` atomically, also when called inside an open transaction. */
function atomic<T>(fn: () => T): T {
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

// ---- Lists --------------------------------------------------------------------

type Entry = Record<string, unknown> & { id: string };

/** The entries of a stored list, if it is a JSON array of objects with unique string ids; else null. */
function listEntries(value: string): Entry[] | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    return null;
  }
  if (!Array.isArray(parsed)) return null;
  const ids = new Set<string>();
  for (const entry of parsed) {
    if (typeof entry !== 'object' || entry === null || Array.isArray(entry) || typeof entry.id !== 'string')
      return null;
    if (ids.has(entry.id)) return null;
    ids.add(entry.id);
  }
  return parsed as Entry[];
}

/** The entries of a status history, if it is a JSON array of objects; else null. */
function historyEntries(value: string): Record<string, unknown>[] | null {
  try {
    const parsed: unknown = JSON.parse(value);
    if (Array.isArray(parsed) && parsed.every((e) => typeof e === 'object' && e !== null && !Array.isArray(e))) {
      return parsed as Record<string, unknown>[];
    }
  } catch {
    // kept as it is below
  }
  return null;
}

const listName = (kind: 'localApps' | 'baseProfiles') => STORAGE_KEYS[kind];

function hasList(userId: number, kind: 'localApps' | 'baseProfiles'): boolean {
  return !!db.prepare('SELECT 1 FROM stored_lists WHERE user_id = ? AND list = ?').get(userId, listName(kind));
}

function setListStored(userId: number, kind: 'localApps' | 'baseProfiles', stored: boolean) {
  if (stored)
    db.prepare('INSERT OR IGNORE INTO stored_lists (user_id, list) VALUES (?, ?)').run(userId, listName(kind));
  else db.prepare('DELETE FROM stored_lists WHERE user_id = ? AND list = ?').run(userId, listName(kind));
}

/** Drops application rows that no longer hold anything. */
function pruneApplications(userId: number) {
  db.prepare(
    'DELETE FROM applications WHERE user_id = ? AND config IS NULL AND saved_edits IS NULL AND legacy_status IS NULL',
  ).run(userId);
}

function readApplications(userId: number): string | null {
  if (!hasList(userId, 'localApps')) return null;
  const rows = db
    .prepare('SELECT config FROM applications WHERE user_id = ? AND config IS NOT NULL ORDER BY position')
    .all(userId) as { config: string }[];
  return JSON.stringify(rows.map((r) => JSON.parse(r.config)));
}

function writeApplications(userId: number, entries: Entry[] | null) {
  db.prepare('UPDATE applications SET position = NULL, config = NULL WHERE user_id = ?').run(userId);
  if (entries) {
    const upsert = db.prepare(
      `INSERT INTO applications (user_id, id, position, config) VALUES (?, ?, ?, ?)
       ON CONFLICT (user_id, id) DO UPDATE SET position = excluded.position, config = excluded.config`,
    );
    entries.forEach((entry, i) => upsert.run(userId, entry.id, i, JSON.stringify(entry)));
  }
  setListStored(userId, 'localApps', entries !== null);
  pruneApplications(userId);
}

function readBaseProfiles(userId: number): string | null {
  if (!hasList(userId, 'baseProfiles')) return null;
  const rows = db.prepare('SELECT data FROM base_profiles WHERE user_id = ? ORDER BY position').all(userId) as {
    data: string;
  }[];
  return JSON.stringify(rows.map((r) => JSON.parse(r.data)));
}

function writeBaseProfiles(userId: number, entries: Entry[] | null) {
  db.prepare('DELETE FROM base_profiles WHERE user_id = ?').run(userId);
  if (entries) {
    const insert = db.prepare('INSERT INTO base_profiles (user_id, id, position, data) VALUES (?, ?, ?, ?)');
    entries.forEach((entry, i) => insert.run(userId, entry.id, i, JSON.stringify(entry)));
  }
  setListStored(userId, 'baseProfiles', entries !== null);
}

function readHistory(userId: number, appId: string): string | null {
  const rows = db
    .prepare('SELECT entry FROM status_transitions WHERE user_id = ? AND app_id = ? ORDER BY position')
    .all(userId, appId) as { entry: string }[];
  // A history with no steps isn't valid anyway; an empty one is stored as it is.
  return rows.length ? JSON.stringify(rows.map((r) => JSON.parse(r.entry))) : null;
}

function writeHistory(userId: number, appId: string, entries: Record<string, unknown>[] | null) {
  db.prepare('DELETE FROM status_transitions WHERE user_id = ? AND app_id = ?').run(userId, appId);
  if (!entries) return;
  const insert = db.prepare('INSERT INTO status_transitions (user_id, app_id, position, entry) VALUES (?, ?, ?, ?)');
  entries.forEach((entry, i) => insert.run(userId, appId, i, JSON.stringify(entry)));
}

// ---- Single values ---------------------------------------------------------------

function setApplicationColumn(
  userId: number,
  id: string,
  column: 'saved_edits' | 'legacy_status',
  value: string | null,
) {
  if (value === null) {
    db.prepare(`UPDATE applications SET ${column} = NULL WHERE user_id = ? AND id = ?`).run(userId, id);
    pruneApplications(userId);
    return;
  }
  db.prepare(
    `INSERT INTO applications (user_id, id, ${column}) VALUES (?, ?, ?)
     ON CONFLICT (user_id, id) DO UPDATE SET ${column} = excluded.${column}`,
  ).run(userId, id, value);
}

function getSetting(userId: number, key: string): string | null {
  const row = db.prepare('SELECT value FROM user_settings WHERE user_id = ? AND key = ?').get(userId, key) as
    { value: string } | undefined;
  return row?.value ?? null;
}

function setSetting(userId: number, key: string, value: string | null) {
  if (value === null) db.prepare('DELETE FROM user_settings WHERE user_id = ? AND key = ?').run(userId, key);
  else {
    db.prepare(
      'INSERT INTO user_settings (user_id, key, value) VALUES (?, ?, ?) ON CONFLICT (user_id, key) DO UPDATE SET value = excluded.value',
    ).run(userId, key, value);
  }
}

// ---- Public API -----------------------------------------------------------------------

/** The value last stored under `key`, or null if there is none. */
export function getValue(userId: number, key: string): string | null {
  const k = parseKey(key);
  // A list or history kept as it is (it couldn't be split into rows) wins.
  if (k.kind === 'localApps' || k.kind === 'baseProfiles' || k.kind === 'statusHistory' || k.kind === 'setting') {
    const raw = getSetting(userId, key);
    if (raw !== null || k.kind === 'setting') return raw;
  }
  switch (k.kind) {
    case 'localApps':
      return readApplications(userId);
    case 'baseProfiles':
      return readBaseProfiles(userId);
    case 'statusHistory':
      return readHistory(userId, k.id);
    case 'appConfig':
    case 'status': {
      const column = k.kind === 'appConfig' ? 'saved_edits' : 'legacy_status';
      const row = db
        .prepare(`SELECT ${column} AS value FROM applications WHERE user_id = ? AND id = ?`)
        .get(userId, k.id) as { value: string | null } | undefined;
      return row?.value ?? null;
    }
    case 'profileOverride': {
      const row = db
        .prepare('SELECT profile FROM profile_overrides WHERE user_id = ? AND language = ?')
        .get(userId, k.language) as { profile: string } | undefined;
      return row?.profile ?? null;
    }
    case 'knowledge': {
      const row = db.prepare('SELECT content FROM knowledge_docs WHERE user_id = ? AND doc = ?').get(userId, k.doc) as
        { content: string } | undefined;
      return row?.content ?? null;
    }
  }
}

/** Stores `value` under `key`, or removes the key when `value` is null. */
export function setValue(userId: number, key: string, value: string | null): void {
  atomic(() => {
    const k = parseKey(key);
    switch (k.kind) {
      case 'localApps':
      case 'baseProfiles': {
        const entries = value === null ? null : listEntries(value);
        const write = k.kind === 'localApps' ? writeApplications : writeBaseProfiles;
        write(userId, entries);
        // Kept as it is when it can't be split into rows.
        setSetting(userId, key, value !== null && entries === null ? value : null);
        return;
      }
      case 'statusHistory': {
        const entries = value === null ? null : historyEntries(value);
        writeHistory(userId, k.id, entries && entries.length ? entries : null);
        setSetting(userId, key, value !== null && !(entries && entries.length) ? value : null);
        return;
      }
      case 'appConfig':
        return setApplicationColumn(userId, k.id, 'saved_edits', value);
      case 'status':
        return setApplicationColumn(userId, k.id, 'legacy_status', value);
      case 'profileOverride':
        if (value === null)
          db.prepare('DELETE FROM profile_overrides WHERE user_id = ? AND language = ?').run(userId, k.language);
        else {
          db.prepare(
            'INSERT INTO profile_overrides (user_id, language, profile) VALUES (?, ?, ?) ON CONFLICT (user_id, language) DO UPDATE SET profile = excluded.profile',
          ).run(userId, k.language, value);
        }
        return;
      case 'knowledge':
        if (value === null) db.prepare('DELETE FROM knowledge_docs WHERE user_id = ? AND doc = ?').run(userId, k.doc);
        else {
          db.prepare(
            'INSERT INTO knowledge_docs (user_id, doc, content) VALUES (?, ?, ?) ON CONFLICT (user_id, doc) DO UPDATE SET content = excluded.content',
          ).run(userId, k.doc, value);
        }
        return;
      case 'setting':
        return setSetting(userId, key, value);
    }
  });
}

/** Every key the user has stored, with its value: what the browser loads after login. */
export function allValues(userId: number): Record<string, string> {
  const keys = new Set<string>();
  if (hasList(userId, 'localApps')) keys.add(STORAGE_KEYS.localApps);
  if (hasList(userId, 'baseProfiles')) keys.add(STORAGE_KEYS.baseProfiles);
  const ids = (sql: string) => (db.prepare(sql).all(userId) as { id: string }[]).map((r) => r.id);
  for (const id of ids('SELECT id FROM applications WHERE user_id = ? AND saved_edits IS NOT NULL'))
    keys.add(STORAGE_KEYS.appConfig(id));
  for (const id of ids('SELECT id FROM applications WHERE user_id = ? AND legacy_status IS NOT NULL'))
    keys.add(STORAGE_KEYS.status(id));
  for (const id of ids('SELECT DISTINCT app_id AS id FROM status_transitions WHERE user_id = ?'))
    keys.add(STORAGE_KEYS.statusHistory(id));
  for (const id of ids('SELECT language AS id FROM profile_overrides WHERE user_id = ?'))
    keys.add(STORAGE_KEYS.profileOverride(id));
  for (const id of ids('SELECT doc AS id FROM knowledge_docs WHERE user_id = ?')) keys.add(STORAGE_KEYS.knowledge(id));
  for (const id of ids('SELECT key AS id FROM user_settings WHERE user_id = ?')) keys.add(id);
  const result: Record<string, string> = {};
  for (const key of [...keys].sort()) {
    const value = getValue(userId, key);
    if (value !== null) result[key] = value;
  }
  return result;
}

/** The ids stored under a key prefix, e.g. every id with an `app-config-<id>` key. */
export function idsWithStoredKey(userId: number, prefix: string): string[] {
  const all = Object.keys(allValues(userId)).filter((key) => key.startsWith(prefix));
  // status- also matches status-history-<id>; those aren't status-<id> keys.
  const own = prefix === KEY_PREFIXES.status ? all.filter((key) => !key.startsWith(KEY_PREFIXES.statusHistory)) : all;
  return own.map((key) => key.slice(prefix.length));
}

/** Every user who has a value under `key`, with that value (for housekeeping across all users). */
export function valuesOfAllUsers(key: string): { userId: number; value: string }[] {
  const users = db.prepare('SELECT id FROM users ORDER BY id').all() as { id: number }[];
  return users.flatMap(({ id }) => {
    const value = getValue(id, key);
    return value === null ? [] : [{ userId: id, value }];
  });
}

// ---- One-off move from the kv table ---------------------------------------------------

/**
 * Moves a database from before tables (every value a kv row) into the tables
 * and drops the kv table, in one transaction. A database whose rows were
 * already copied (`kv_moved_at` set; the previous release kept them for a
 * rollback) only loses the table. Without a kv table there is nothing to do,
 * so restoring an old backup file still works.
 */
export function moveKvToTables(): void {
  if (!hasKvTable()) return;
  const moved = db.prepare("SELECT 1 FROM meta WHERE key = 'kv_moved_at'").get() !== undefined;
  atomic(() => {
    if (!moved) {
      const rows = db.prepare('SELECT user_id, key, value FROM kv ORDER BY user_id, key').all() as {
        user_id: number;
        key: string;
        value: string;
      }[];
      for (const row of rows) setValue(row.user_id, row.key, row.value);
      db.prepare("INSERT INTO meta (key, value) VALUES ('kv_moved_at', ?)").run(new Date().toISOString());
    }
    db.exec('DROP TABLE kv');
  });
}

moveKvToTables();
