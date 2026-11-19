// The frontend's raw storage: every key it keeps, read in one go after login
// and written back in batches, plus importing a backup file. Session cookie
// only, so an API token can't overwrite raw storage.
import { Hono } from 'hono';
import type { ApplicationConfig } from '#shared/types.ts';
import { mergeBackup, parseBackupValue } from '#shared/domain/backupMerge.ts';
import { db, transaction } from '../db.ts';
import { affectedAppIds, BROWSER_AUTHOR, deleteVersions, recordChanges, snapshot } from '../history.ts';
import { jsonFields, jsonValue } from '../http.ts';
import { requireUser, type SessionEnv } from '../session.ts';
import { refusedStorageKeys } from '../statusHistory.ts';
import { getJson, KEYS, parseJson } from '../store.ts';

// Mounted at /api, so requireUser goes on each route: a wildcard middleware
// here would also catch /api/login and /api/v1.

const UPSERT =
  'INSERT INTO kv (user_id, key, value) VALUES (?, ?, ?) ON CONFLICT (user_id, key) DO UPDATE SET value = excluded.value';

function allValues(userId: number): Record<string, string> {
  const rows = db.prepare('SELECT key, value FROM kv WHERE user_id = ?').all(userId) as {
    key: string;
    value: string;
  }[];
  return Object.fromEntries(rows.map((r) => [r.key, r.value]));
}

const isStringRecord = (v: unknown): v is Record<string, string> =>
  typeof v === 'object' && v !== null && !Array.isArray(v) && Object.values(v).every((x) => typeof x === 'string');

export const dataRoutes = new Hono<SessionEnv>()
  .get('/data', requireUser, (c) => c.json(allValues(c.get('user').id)))
  // One request carries every write the frontend batched since its last flush,
  // applied atomically so a restore-from-backup can't land half-way. The
  // optional `messages` (application id → note) describe what a save changed,
  // for the version history.
  .put('/data', requireUser, jsonFields<'set' | 'remove' | 'messages'>(), async (c) => {
    const body = c.req.valid('json');
    const rawSet = body.set ?? {};
    const rawRemove = body.remove ?? [];
    const rawMessages = body.messages ?? {};
    if (
      !isStringRecord(rawSet) ||
      !isStringRecord(rawMessages) ||
      !Array.isArray(rawRemove) ||
      !rawRemove.every((k) => typeof k === 'string')
    ) {
      return c.json(
        { error: 'Expected { set: Record<string, string>, remove: string[], messages?: Record<string, string> }.' },
        400,
      );
    }

    const refused = refusedStorageKeys(Object.keys(rawSet));
    if (refused.length) {
      return c.json(
        {
          error: `The status can only change through /api/v1/applications/:id/transitions; refused: ${refused.join(', ')}.`,
        },
        400,
      );
    }

    const userId = c.get('user').id;
    const set = rawSet;
    const remove = rawRemove as string[];
    const messages = new Map(Object.entries(rawMessages));
    const upsert = db.prepare(UPSERT);
    const del = db.prepare('DELETE FROM kv WHERE user_id = ? AND key = ?');
    transaction(() => {
      const listBefore = getJson<ApplicationConfig[]>(userId, KEYS.localApps);
      const listAfter = KEYS.localApps in set ? parseJson<ApplicationConfig[]>(set[KEYS.localApps]) : null;
      const appIds = affectedAppIds(
        [...remove, ...Object.keys(set)],
        KEYS.localApps in set ? [listBefore, listAfter] : [],
      );
      const before = snapshot(userId, appIds);

      for (const key of remove) del.run(userId, key);
      for (const [key, value] of Object.entries(set)) upsert.run(userId, key, value);

      recordChanges(userId, before, BROWSER_AUTHOR, (appId) => messages.get(appId));
      // An application deleted for good takes its history with it.
      if (KEYS.localApps in set) {
        const remaining = new Set((getJson<ApplicationConfig[]>(userId, KEYS.localApps) ?? []).map((a) => a.id));
        for (const app of listBefore ?? []) if (!remaining.has(app.id)) deleteVersions(userId, app.id);
      }
    });
    return c.body(null, 204);
  })
  // Adds a backup file to the account: applications, base profiles and
  // profile overrides it doesn't have yet. Nothing that exists is overwritten
  // (see shared/domain/backupMerge.ts); the answer lists what was added and skipped.
  .post('/import', requireUser, jsonValue(), async (c) => {
    const parsed = parseBackupValue(c.req.valid('json'));
    if (!parsed.ok) return c.json({ error: parsed.error }, 400);
    const userId = c.get('user').id;
    const outcome = transaction(() => {
      const result = mergeBackup(allValues(userId), parsed.backup);
      if (!result.ok) return result;
      const before = snapshot(userId, result.added);
      const upsert = db.prepare(UPSERT);
      for (const [key, value] of Object.entries(result.set)) upsert.run(userId, key, value);
      recordChanges(userId, before, BROWSER_AUTHOR, () => 'Imported from a backup');
      return result;
    });
    if (!outcome.ok) return c.json({ error: outcome.error }, 400);
    const { added, skipped, addedProfiles } = outcome;
    return c.json({ added, skipped, addedProfiles });
  });
