// The app's own base profile routes (session cookie only). Unlike the strict
// /api/v1/base-profiles for scripts and assistants, these follow how the app
// works: a profile may be saved as a draft (e.g. without a name yet), may go
// to the trash while applications still use it (the app warns), and may be
// deleted for good. Every route answers with the whole list, trash included,
// so the app can replace its cached copy.
import { Hono } from 'hono';
import { z } from 'zod';
import type { BaseProfile, Profile } from '#shared/types.ts';
import { LANGUAGES } from '#shared/utils/language.ts';
import { transaction } from '../db.ts';
import { jsonValue } from '../http.ts';
import { requireUser, type SessionEnv } from '../session.ts';
import { getJson, KEYS, setJson } from '../store.ts';

const baseProfileSchema: z.ZodType<BaseProfile> = z.object({
  id: z.string().min(1),
  name: z.string(),
  language: z.enum(LANGUAGES as [BaseProfile['language'], ...BaseProfile['language'][]]),
  // A draft is fine here; the editor checks the content.
  profile: z.custom<Profile>((v) => typeof v === 'object' && v !== null && !Array.isArray(v)),
  deletedAt: z.string().optional(),
});

const parseProfile = (value: unknown) => baseProfileSchema.safeParse(value);

/** The stored list, or null if the app never stored one (it then seeds the language defaults). */
function stored(userId: number): BaseProfile[] | null {
  return getJson<BaseProfile[]>(userId, KEYS.baseProfiles);
}

/** Changes the list in one transaction; `change` returns the new list, or null if `id` is unknown. */
function update(userId: number, change: (list: BaseProfile[]) => BaseProfile[] | null): BaseProfile[] | null {
  return transaction(() => {
    const next = change(stored(userId) ?? []);
    if (next) setJson(userId, KEYS.baseProfiles, next);
    return next;
  });
}

const notFound = { error: 'No such base profile.' } as const;

export const baseProfileRoutes = new Hono<SessionEnv>()
  .use('*', requireUser)
  // Null until the app has stored a list.
  .get('/', (c) => c.json(stored(c.get('user').id)))
  // The language defaults, stored only if no list was ever stored (two tabs
  // seeding at once keep the first); answers with whatever is stored then.
  .post('/seed', jsonValue(), (c) => {
    const profiles = z.array(baseProfileSchema).safeParse(c.req.valid('json'));
    if (!profiles.success) return c.json({ error: 'Expected a list of base profiles.' }, 400);
    const userId = c.get('user').id;
    const list = transaction(() => {
      const current = stored(userId);
      if (current) return current;
      setJson(userId, KEYS.baseProfiles, profiles.data);
      return profiles.data;
    });
    return c.json(list);
  })
  // Creates the profile or replaces it in place.
  .put('/:id', jsonValue(), (c) => {
    const profile = parseProfile(c.req.valid('json'));
    if (!profile.success) return c.json({ error: 'Expected a base profile.' }, 400);
    if (profile.data.id !== c.req.param('id')) return c.json({ error: 'The id cannot change.' }, 400);
    const saved = profile.data;
    const list = update(c.get('user').id, (current) =>
      current.some((p) => p.id === saved.id)
        ? current.map((p) => (p.id === saved.id ? saved : p))
        : [...current, saved],
    );
    return c.json(list);
  })
  .post('/:id/trash', (c) => {
    const id = c.req.param('id');
    const deletedAt = new Date().toISOString();
    const list = update(c.get('user').id, (current) =>
      current.some((p) => p.id === id) ? current.map((p) => (p.id === id ? { ...p, deletedAt } : p)) : null,
    );
    return list ? c.json(list) : c.json(notFound, 404);
  })
  .post('/:id/restore', (c) => {
    const id = c.req.param('id');
    const list = update(c.get('user').id, (current) =>
      current.some((p) => p.id === id)
        ? current.map((p) => {
            if (p.id !== id) return p;
            const { deletedAt: _deletedAt, ...rest } = p;
            return rest;
          })
        : null,
    );
    return list ? c.json(list) : c.json(notFound, 404);
  })
  // For good, without the trash. Session only: API tokens can't delete for good.
  .delete('/:id', (c) => {
    const id = c.req.param('id');
    const list = update(c.get('user').id, (current) =>
      current.some((p) => p.id === id) ? current.filter((p) => p.id !== id) : null,
    );
    return list ? c.json(list) : c.json(notFound, 404);
  });
