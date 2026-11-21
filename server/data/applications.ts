// The user's applications: their list (one row per entry, in list order), the
// edits saved over each one, and the single status stored for applications
// from before status histories. Rows are keyed by application id; an id can
// have edits or a status without a list entry (an application bundled with
// the app).
import type { ApplicationConfig, ApplicationStatus } from '#shared/types.ts';
import { db } from '../db.ts';
import { parseStored } from './json.ts';
import { atomic } from './schema.ts';
import { removeStatusHistory } from './statusTransitions.ts';

export type StoredConfig = Omit<ApplicationConfig, 'status'>;

type Column = 'saved_edits' | 'legacy_status';

/** Drops rows that no longer hold anything. */
function prune(userId: number): void {
  db.prepare(
    'DELETE FROM applications WHERE user_id = ? AND config IS NULL AND saved_edits IS NULL AND legacy_status IS NULL',
  ).run(userId);
}

/** The list, trash included, in its order. */
export function applicationList(userId: number): ApplicationConfig[] {
  const rows = db
    .prepare('SELECT config FROM applications WHERE user_id = ? AND config IS NOT NULL ORDER BY position')
    .all(userId) as { config: string }[];
  return rows.map((r) => JSON.parse(r.config) as ApplicationConfig);
}

/** Replaces the list; saved edits and statuses stay with their ids. */
export function saveApplicationList(userId: number, list: readonly ApplicationConfig[]): void {
  atomic(() => {
    db.prepare('UPDATE applications SET position = NULL, config = NULL WHERE user_id = ?').run(userId);
    const upsert = db.prepare(
      `INSERT INTO applications (user_id, id, position, config) VALUES (?, ?, ?, ?)
       ON CONFLICT (user_id, id) DO UPDATE SET position = excluded.position, config = excluded.config`,
    );
    list.forEach((app, i) => upsert.run(userId, app.id, i, JSON.stringify(app)));
    prune(userId);
  });
}

function readColumn(userId: number, id: string, column: Column): string | null {
  const row = db.prepare(`SELECT ${column} AS value FROM applications WHERE user_id = ? AND id = ?`).get(userId, id) as
    | { value: string | null }
    | undefined;
  return row?.value ?? null;
}

function writeColumn(userId: number, id: string, column: Column, value: string | null): void {
  if (value === null) {
    db.prepare(`UPDATE applications SET ${column} = NULL WHERE user_id = ? AND id = ?`).run(userId, id);
    prune(userId);
    return;
  }
  db.prepare(
    `INSERT INTO applications (user_id, id, ${column}) VALUES (?, ?, ?)
     ON CONFLICT (user_id, id) DO UPDATE SET ${column} = excluded.${column}`,
  ).run(userId, id, value);
}

/** The edits saved over the application, or null if there are none (or they're unreadable). */
export function savedEdits(userId: number, id: string): StoredConfig | null {
  return parseStored<StoredConfig>(rawSavedEdits(userId, id));
}

/** Saves edits over the application, or drops them with null. */
export function setSavedEdits(userId: number, id: string, config: StoredConfig | null): void {
  writeColumn(userId, id, 'saved_edits', config === null ? null : JSON.stringify(config));
}

/** The saved edits as stored, for data in the old format (./legacyKeys.ts). */
export function rawSavedEdits(userId: number, id: string): string | null {
  return readColumn(userId, id, 'saved_edits');
}

/** Saves edits exactly as they arrived in the old format; they may not even be valid JSON. */
export function setRawSavedEdits(userId: number, id: string, raw: string | null): void {
  writeColumn(userId, id, 'saved_edits', raw);
}

/** The single status stored for an application from before status histories, if any. */
export function legacyStatus(userId: number, id: string): ApplicationStatus | null {
  return readColumn(userId, id, 'legacy_status') as ApplicationStatus | null;
}

export function setLegacyStatus(userId: number, id: string, status: string | null): void {
  writeColumn(userId, id, 'legacy_status', status);
}

/** Every id with saved edits, a legacy status or a status history, listed or not. */
export function applicationIdsWithData(userId: number): string[] {
  const rows = db
    .prepare(
      `SELECT id FROM applications WHERE user_id = ? AND (saved_edits IS NOT NULL OR legacy_status IS NOT NULL)
       UNION SELECT app_id AS id FROM status_transitions WHERE user_id = ?
       ORDER BY id`,
    )
    .all(userId, userId) as { id: string }[];
  return rows.map((r) => r.id);
}

/** Drops an application's saved edits, legacy status and status history; its list entry stays. */
export function removeApplicationData(userId: number, id: string): void {
  atomic(() => {
    writeColumn(userId, id, 'saved_edits', null);
    writeColumn(userId, id, 'legacy_status', null);
    removeStatusHistory(userId, id);
  });
}
