import { isPurgeDue } from '#shared/utils/trash.ts';
import { db, transaction } from './db.ts';
import { applicationList, removeApplicationData, saveApplicationList } from './data/applications.ts';
import { baseProfileList, saveBaseProfileList } from './data/baseProfiles.ts';
import { deleteVersions } from './history.ts';

interface Trashable {
  id: string;
  deletedAt?: string;
}

/**
 * Takes the entries whose time in the trash is up out of one list (the
 * applications or the base profiles), for every user, and returns them per
 * user. `read` and `save` are that list's functions.
 */
function purgeList<T extends Trashable>(
  now: number,
  read: (userId: number) => T[] | null,
  save: (userId: number, list: T[]) => void,
): { userId: number; purged: T[] }[] {
  const users = db.prepare('SELECT id FROM users ORDER BY id').all() as { id: number }[];
  const due = (item: T) => !!item.deletedAt && isPurgeDue(item.deletedAt, now);
  return users.flatMap(({ id: userId }) => {
    const list = read(userId) ?? [];
    const purged = list.filter(due);
    if (!purged.length) return [];
    save(
      userId,
      list.filter((item) => !due(item)),
    );
    return [{ userId, purged }];
  });
}

/**
 * Permanently removes trashed applications and base profiles whose retention
 * period has passed. A purged application takes its saved edits, status and
 * version history with it; applications still pointing at a purged base profile fall back to
 * the language default profile, as the app warns. Returns the counts.
 */
export function purgeTrash(now: number = Date.now()): { applications: number; baseProfiles: number } {
  return transaction(() => {
    const apps = purgeList(now, applicationList, saveApplicationList);
    for (const { userId, purged } of apps) {
      for (const app of purged) {
        removeApplicationData(userId, app.id);
        deleteVersions(userId, app.id);
      }
    }
    const profiles = purgeList(now, baseProfileList, saveBaseProfileList);
    const count = (r: { purged: unknown[] }[]) => r.reduce((n, { purged }) => n + purged.length, 0);
    return { applications: count(apps), baseProfiles: count(profiles) };
  });
}
