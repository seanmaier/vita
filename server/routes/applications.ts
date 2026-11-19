// The app's own application routes (session cookie only). The app keeps two
// things per application: its entry in the user's list (or, for one bundled
// from private/applications/, none) and its saved edits, laid over that entry;
// "Reset to default" drops the edits. /api/v1/applications serves scripts and
// assistants the merged view and can't delete anything; these routes follow
// how the app works, including deleting for good. Every write is recorded in
// the version history like before, and every route answers with all of the
// user's applications so the app can replace its cached copy. Status changes
// go through /api/v1/applications/:id/transitions.
import { Hono, type Context } from 'hono';
import { z } from 'zod';
import type { ApplicationConfig, StatusTransition } from '#shared/types.ts';
import { transaction } from '../db.ts';
import { BROWSER_AUTHOR, deleteVersions, recordChanges, snapshot } from '../history.ts';
import { jsonValue } from '../http.ts';
import { requireUser, type SessionEnv } from '../session.ts';
import { historyFor } from '../statusHistory.ts';
import { getJson, idsWithStoredKey, KEYS, removeValue, setJson } from '../store.ts';

type StoredConfig = Omit<ApplicationConfig, 'status'>;

export interface StoredApplication {
  id: string;
  /** Its entry in the user's list; null for one bundled with the app that only has saved edits or a status. */
  config: ApplicationConfig | null;
  /** The edits saved over the entry; null when there are none. */
  savedEdits: StoredConfig | null;
  /** Null when the server can't tell (a bundled application without a recorded status). */
  statusHistory: StatusTransition[] | null;
}

// The app stores what its forms produce; the editor and the import check the content.
const configSchema = z
  .object({ id: z.string().min(1), company: z.string(), role: z.string() })
  .passthrough() as unknown as z.ZodType<ApplicationConfig>;
const savedEditsSchema = z.object({
  config: z.object({ id: z.string().min(1) }).passthrough() as unknown as z.ZodType<StoredConfig>,
  message: z.string().max(500).optional(),
});

function list(userId: number): ApplicationConfig[] {
  return getJson<ApplicationConfig[]>(userId, KEYS.localApps) ?? [];
}

/** All of the user's applications: list entries first, in order, then any others with saved edits or a status. */
export function storedApplications(userId: number): StoredApplication[] {
  const entries = list(userId);
  const ids = [
    ...new Set([
      ...entries.map((a) => a.id),
      ...idsWithStoredKey(userId, KEYS.appConfig('')),
      ...idsWithStoredKey(userId, KEYS.statusHistory('')),
      ...idsWithStoredKey(userId, KEYS.status('')),
    ]),
  ];
  return ids.map((id) => {
    const config = entries.find((a) => a.id === id) ?? null;
    return {
      id,
      config,
      savedEdits: getJson<StoredConfig>(userId, KEYS.appConfig(id)),
      statusHistory: historyFor(userId, id, config ?? undefined),
    };
  });
}

/**
 * Runs a write in one transaction and records what it changed in the version
 * history (author "browser", like edits made in the app), then answers with
 * every application. `run` returns false when `id` is unknown (404).
 */
function write(c: Context<SessionEnv>, id: string, run: (userId: number) => boolean, message?: string) {
  const userId = c.get('user').id;
  const found = transaction(() => {
    const before = snapshot(userId, [id]);
    if (!run(userId)) return false;
    recordChanges(userId, before, BROWSER_AUTHOR, () => message);
    return true;
  });
  return found ? c.json(storedApplications(userId)) : c.json({ error: 'No such application.' }, 404);
}

function changeEntry(userId: number, id: string, change: (a: ApplicationConfig) => ApplicationConfig): boolean {
  const entries = list(userId);
  if (!entries.some((a) => a.id === id)) return false;
  setJson(
    userId,
    KEYS.localApps,
    entries.map((a) => (a.id === id ? change(a) : a)),
  );
  return true;
}

export const applicationRoutes = new Hono<SessionEnv>()
  .use('*', requireUser)
  .get('/', (c) => c.json(storedApplications(c.get('user').id)))
  // Adds the application to the list or replaces its entry in place.
  .put('/:id', jsonValue(), (c) => {
    const id = c.req.param('id');
    const config = configSchema.safeParse(c.req.valid('json'));
    if (!config.success) return c.json({ error: 'Expected an application with id, company and role.' }, 400);
    if (config.data.id !== id) return c.json({ error: 'The id cannot change.' }, 400);
    return write(c, id, (userId) => {
      const entries = list(userId);
      const next = entries.some((a) => a.id === id)
        ? entries.map((a) => (a.id === id ? config.data : a))
        : [...entries, config.data];
      setJson(userId, KEYS.localApps, next);
      return true;
    });
  })
  // Saves the editor's state over the entry; `message` says what changed, for the version history.
  .put('/:id/saved-edits', jsonValue(), (c) => {
    const id = c.req.param('id');
    const body = savedEditsSchema.safeParse(c.req.valid('json'));
    if (!body.success) return c.json({ error: 'Expected { config, message? }.' }, 400);
    if (body.data.config.id !== id) return c.json({ error: 'The id cannot change.' }, 400);
    return write(
      c,
      id,
      (userId) => {
        setJson(userId, KEYS.appConfig(id), body.data.config);
        return true;
      },
      body.data.message,
    );
  })
  // "Reset to default": back to the entry as it was created or imported.
  .delete('/:id/saved-edits', (c) => {
    const id = c.req.param('id');
    return write(c, id, (userId) => {
      removeValue(userId, KEYS.appConfig(id));
      return true;
    });
  })
  .post('/:id/trash', (c) => {
    const id = c.req.param('id');
    const deletedAt = new Date().toISOString();
    return write(c, id, (userId) => changeEntry(userId, id, (a) => ({ ...a, deletedAt })));
  })
  .post('/:id/restore', (c) => {
    const id = c.req.param('id');
    return write(c, id, (userId) =>
      changeEntry(userId, id, (a) => {
        const { deletedAt: _deletedAt, ...rest } = a;
        return rest;
      }),
    );
  })
  // For good, with its saved edits, status and version history. Session only:
  // API tokens can't delete for good.
  .delete('/:id', (c) => {
    const id = c.req.param('id');
    const userId = c.get('user').id;
    const found = transaction(() => {
      const entries = list(userId);
      if (!entries.some((a) => a.id === id)) return false;
      setJson(
        userId,
        KEYS.localApps,
        entries.filter((a) => a.id !== id),
      );
      for (const key of [KEYS.appConfig(id), KEYS.status(id), KEYS.statusHistory(id)]) removeValue(userId, key);
      deleteVersions(userId, id);
      return true;
    });
    return found ? c.json(storedApplications(userId)) : c.json({ error: 'No such application.' }, 404);
  });
