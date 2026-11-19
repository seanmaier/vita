// The app's per-account settings (session cookie only). For now that is only
// whether the guided tour was closed, so it opens once per account.
import { Hono } from 'hono';
import { requireUser, type SessionEnv } from '../session.ts';
import { getValue, KEYS, setValue } from '../store.ts';

export interface Settings {
  tourSeen: boolean;
}

const settingsOf = (userId: number): Settings => ({ tourSeen: getValue(userId, KEYS.tourSeen) !== null });

export const settingsRoutes = new Hono<SessionEnv>()
  .use('*', requireUser)
  .get('/', (c) => c.json(settingsOf(c.get('user').id)))
  .put('/tour-seen', (c) => {
    const userId = c.get('user').id;
    setValue(userId, KEYS.tourSeen, '1');
    return c.json(settingsOf(userId));
  });
