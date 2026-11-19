// Edits to a language's default profile, from before base profiles existed
// (profile-override-<language>). Nothing writes them any more except a backup
// import; the app reads them to show the language defaults as the user left
// them. Session cookie only.
import { Hono } from 'hono';
import type { AppLanguage, Profile } from '#shared/types.ts';
import { LANGUAGES } from '#shared/utils/language.ts';
import { requireUser, type SessionEnv } from '../session.ts';
import { getJson, KEYS } from '../store.ts';

export const profileOverrideRoutes = new Hono<SessionEnv>()
  .use('*', requireUser)
  // Only the languages that have one.
  .get('/', (c) => {
    const userId = c.get('user').id;
    const overrides: Partial<Record<AppLanguage, Profile>> = {};
    for (const language of LANGUAGES) {
      const profile = getJson<Profile>(userId, KEYS.profileOverride(language));
      if (profile) overrides[language] = profile;
    }
    return c.json(overrides);
  });
