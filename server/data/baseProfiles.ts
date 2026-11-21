// The user's base profiles, one row per profile in list order.
import type { BaseProfile } from '#shared/types.ts';
import { db } from '../db.ts';
import { atomic } from './schema.ts';

const LIST = 'base-profiles';

/** The list, trash included; null if none was ever stored (the app then seeds the language defaults). */
export function baseProfileList(userId: number): BaseProfile[] | null {
  if (!db.prepare('SELECT 1 FROM stored_lists WHERE user_id = ? AND list = ?').get(userId, LIST)) return null;
  const rows = db.prepare('SELECT data FROM base_profiles WHERE user_id = ? ORDER BY position').all(userId) as {
    data: string;
  }[];
  return rows.map((r) => JSON.parse(r.data) as BaseProfile);
}

export function saveBaseProfileList(userId: number, list: readonly BaseProfile[]): void {
  atomic(() => {
    db.prepare('DELETE FROM base_profiles WHERE user_id = ?').run(userId);
    const insert = db.prepare('INSERT INTO base_profiles (user_id, id, position, data) VALUES (?, ?, ?, ?)');
    list.forEach((profile, i) => insert.run(userId, profile.id, i, JSON.stringify(profile)));
    db.prepare('INSERT OR IGNORE INTO stored_lists (user_id, list) VALUES (?, ?)').run(userId, LIST);
  });
}
