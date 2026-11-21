// Adds a backup file to the account. Session cookie only, so an API token
// can't import into an account.
import { Hono } from 'hono';
import { mergeBackup, parseBackupValue } from '#shared/domain/backupMerge.ts';
import { transaction } from '../db.ts';
import { BROWSER_AUTHOR, recordChanges, snapshot } from '../history.ts';
import { jsonValue } from '../http.ts';
import { requireUser, type SessionEnv } from '../session.ts';
import { allValues, setValue } from '../store.ts';

// Mounted at /api, so requireUser goes on the route: a wildcard middleware
// here would also catch /api/login and /api/v1.
export const importRoutes = new Hono<SessionEnv>()
  // Applications, base profiles and profile overrides the account doesn't have
  // yet. Nothing that exists is overwritten (see shared/domain/backupMerge.ts);
  // the answer lists what was added and skipped.
  .post('/import', requireUser, jsonValue(), async (c) => {
    const parsed = parseBackupValue(c.req.valid('json'));
    if (!parsed.ok) return c.json({ error: parsed.error }, 400);
    const userId = c.get('user').id;
    const outcome = transaction(() => {
      const result = mergeBackup(allValues(userId), parsed.backup);
      if (!result.ok) return result;
      const before = snapshot(userId, result.added);
      for (const [key, value] of Object.entries(result.set)) setValue(userId, key, value);
      recordChanges(userId, before, BROWSER_AUTHOR, () => 'Imported from a backup');
      return result;
    });
    if (!outcome.ok) return c.json({ error: outcome.error }, 400);
    const { added, skipped, addedProfiles } = outcome;
    return c.json({ added, skipped, addedProfiles });
  });
