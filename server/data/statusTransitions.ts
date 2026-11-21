// Each application's status history, one step per row. Reading it as a valid
// history (and seeding one where none is recorded) is ../statusHistory.ts.
import { db } from '../db.ts';
import { atomic } from './schema.ts';

/** The recorded steps in order, as stored; null if there are none. */
export function recordedSteps(userId: number, appId: string): unknown[] | null {
  const rows = db
    .prepare('SELECT entry FROM status_transitions WHERE user_id = ? AND app_id = ? ORDER BY position')
    .all(userId, appId) as { entry: string }[];
  return rows.length ? rows.map((r) => JSON.parse(r.entry) as unknown) : null;
}

/** Replaces the application's steps. */
export function saveSteps(userId: number, appId: string, steps: readonly object[]): void {
  atomic(() => {
    removeStatusHistory(userId, appId);
    const insert = db.prepare('INSERT INTO status_transitions (user_id, app_id, position, entry) VALUES (?, ?, ?, ?)');
    steps.forEach((step, i) => insert.run(userId, appId, i, JSON.stringify(step)));
  });
}

export function removeStatusHistory(userId: number, appId: string): void {
  db.prepare('DELETE FROM status_transitions WHERE user_id = ? AND app_id = ?').run(userId, appId);
}
