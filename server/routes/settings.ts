// The app's per-account settings (session cookie only). For now that is only
// whether the guided tour was closed, so it opens once per account.
import { Hono } from 'hono';
import { requireUser, type SessionEnv } from '../session.ts';
import { STORAGE_KEYS } from '#shared/storageKeys.ts';
import { setSetting, setting } from '../data/documents.ts';

export interface Settings {
  tourSeen: boolean;
}

const settingsOf = (userId: number): Settings => ({ tourSeen: setting(userId, STORAGE_KEYS.tourSeen) !== null });

export const settingsRoutes = new Hono<SessionEnv>()
  .use('*', requireUser)
  .get('/', (c) => c.json(settingsOf(c.get('user').id)))
  .put('/tour-seen', (c) => {
    const userId = c.get('user').id;
    setSetting(userId, STORAGE_KEYS.tourSeen, '1');
    return c.json(settingsOf(userId));
  });
