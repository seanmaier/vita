// One-off moves of each user's data into the tables, run once when the server
// starts (imported by ../app.ts). Both are idempotent and skip themselves
// when there is nothing to do.
import { db, hasKvTable } from '../db.ts';
import { writeLegacyValue } from './legacyKeys.ts';
import { atomic } from './schema.ts';

/**
 * Moves a database from before tables (every value a kv row) into the tables
 * and drops the kv table, in one transaction. A database whose rows were
 * already copied (`kv_moved_at` set; the release before kept them for a
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
      for (const row of rows) writeLegacyValue(row.user_id, row.key, row.value);
      db.prepare("INSERT INTO meta (key, value) VALUES ('kv_moved_at', ?)").run(new Date().toISOString());
    }
    db.exec('DROP TABLE kv');
  });
}

/**
 * The first move into tables kept a list or status history it couldn't split
 * into rows (duplicate ids, entries without an id, corrupt JSON) as it was,
 * under its key in user_settings. Those are split now as far as they can be:
 * the readable entries become rows, each id once, and the original value
 * stays as unreadable:<key> whenever anything of it couldn't be used.
 */
export function splitKeptValues(): void {
  const rows = db
    .prepare(
      "SELECT user_id, key, value FROM user_settings WHERE key IN ('local-apps', 'base-profiles') OR key LIKE 'status-history-%'",
    )
    .all() as { user_id: number; key: string; value: string }[];
  atomic(() => {
    for (const row of rows) {
      db.prepare('DELETE FROM user_settings WHERE user_id = ? AND key = ?').run(row.user_id, row.key);
      writeLegacyValue(row.user_id, row.key, row.value);
    }
    // Only the base profiles still need to tell an empty list from none.
    db.prepare("DELETE FROM stored_lists WHERE list = 'local-apps'").run();
  });
}

moveKvToTables();
splitKeptValues();
