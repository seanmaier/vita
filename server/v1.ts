// Resource-oriented API for scripts and assistants (authenticated with an API
// token or the session cookie). Unlike /api/data, which the frontend uses to
// sync raw storage keys, these routes work on one application or base profile
// at a time and return the merged, effective view of it.
import { Hono, type Context } from 'hono';
import { allowedNext, appendTransition, currentStatus, derivedDates, INITIAL_STATUSES, isIsoDate, isStoredStatus, setTransitionDate, undoLast } from '../src/domain/statusMachine.ts';
import type { AppLanguage, ApplicationConfig, ApplicationStatus, BaseProfile, SkillGroup, StatusTransition, StoredStatus } from '../src/types.ts';
import { validateApplicationConfig } from '../src/utils/parseApplicationConfig.ts';
import { validateProfile } from '../src/utils/parseProfile.ts';
import { validateSkillGroups } from '../src/utils/parseSkillGroups.ts';
import { isAppLanguage, LANGUAGE_ERROR, LANGUAGES, languageOf } from '../src/utils/language.ts';
import { todayIso } from '../src/utils/date.ts';
import { slugify, uniqueId } from '../src/utils/slug.ts';
import { purgeDate } from '../src/utils/trash.ts';
import { transaction } from './db.ts';
import { BROWSER_AUTHOR, getVersion, listVersions, recordChanges, snapshot } from './history.ts';
import { invalid, readBody, type Body, type V1Env, type Validated } from './http.ts';
import { inboundMail } from './inboundMail.ts';
import { jobAlerts } from './jobAlerts.ts';
import { jobLeads } from './jobLeads.ts';
import { knowledge } from './knowledge.ts';
import { historyFor, writeHistory } from './statusHistory.ts';
import { getJson, idsWithStoredKey, KEYS, setJson } from './store.ts';

type StoredConfig = Omit<ApplicationConfig, 'status'>;

export const v1 = new Hono<V1Env>();

/** Who a write is recorded as in the version history: the API token's name, or the app for session calls. */
const authorOf = (c: Context) => (c.get('apiToken') as string | undefined) ?? BROWSER_AUTHOR;

function localApps(userId: number): ApplicationConfig[] {
  return getJson<ApplicationConfig[]>(userId, KEYS.localApps) ?? [];
}

/** An application as the API returns it: with its status history, from which status and dates are derived. */
export type EffectiveApplication = ApplicationConfig & { statusHistory: StatusTransition[] };

// The dates are derived from the status history; values still lying in old
// saved data are dropped so they can't contradict it.
function withoutStatusFields<T extends Partial<ApplicationConfig>>(config: T) {
  const { appliedDate: _a, interviewDate: _i, finalDecisionDate: _f, ...rest } = config;
  return rest;
}

// Mirrors what the app renders: the stored application, overlaid with the
// edits saved for it (useApplication), with status and dates from its status
// history. Whether it's in the trash is only ever recorded on the stored entry.
function effectiveApplication(userId: number, base: ApplicationConfig): EffectiveApplication {
  const override = getJson<StoredConfig>(userId, KEYS.appConfig(base.id));
  const merged = withoutStatusFields({ ...base, ...override, id: base.id, deletedAt: base.deletedAt });
  const statusHistory = historyFor(userId, base.id, base)!;
  return {
    ...merged,
    status: currentStatus(statusHistory, todayIso()),
    ...derivedDates(statusHistory, languageOf(merged)),
    statusHistory,
  };
}

function findApplication(userId: number, id: string): EffectiveApplication | null {
  const base = localApps(userId).find((a) => a.id === id);
  return base ? effectiveApplication(userId, base) : null;
}

function baseProfiles(userId: number): BaseProfile[] | null {
  return getJson<BaseProfile[]>(userId, KEYS.baseProfiles);
}

/**
 * Lists leave trashed items out; with `?trash=true` they list only those,
 * each with the time it will be purged.
 */
function listView<T extends { deletedAt?: string }>(c: Context, items: T[]) {
  if (c.req.query('trash') !== 'true') return c.json(items.filter((i) => !i.deletedAt));
  return c.json(
    items.filter((i) => i.deletedAt).map((i) => ({ ...i, purgesAt: purgeDate(i.deletedAt!).toISOString() })),
  );
}

v1.route('/knowledge', knowledge);
v1.route('/job-leads', jobLeads);
v1.route('/job-alerts', jobAlerts);
v1.route('/inbound-mail', inboundMail);

v1.get('/me', (c) => c.json(c.get('user')));

// Optional ?language=en|de|sv narrows the list; applications without a stored
// language count as English, like in the app.
v1.get('/applications', (c) => {
  const userId = c.get('user').id;
  const language = c.req.query('language');
  if (language !== undefined && !isAppLanguage(language)) {
    return invalid(c, [`Unknown language "${language}". Use one of: ${LANGUAGES.join(', ')}.`]);
  }
  const apps = localApps(userId).map((a) => effectiveApplication(userId, a));
  return listView(c, language ? apps.filter((a) => languageOf(a) === language) : apps);
});

v1.get('/applications/:id', (c) => {
  const app = findApplication(c.get('user').id, c.req.param('id'));
  return app ? c.json(app) : c.json({ error: 'No such application.' }, 404);
});

// Empty until the app has been opened once: the frontend seeds the list from
// the legacy per-language profiles on first use.
v1.get('/base-profiles', (c) => listView(c, baseProfiles(c.get('user').id) ?? []));

v1.get('/base-profiles/:id', (c) => {
  const profile = baseProfiles(c.get('user').id)?.find((p) => p.id === c.req.param('id'));
  return profile ? c.json(profile) : c.json({ error: 'No such base profile.' }, 404);
});

// ---- Writes ---------------------------------------------------------------
// Every write is one read-modify-write inside a transaction, so concurrent
// API calls can't lose each other's changes. Nothing here deletes for good:
// base profiles only go to the trash (see below), applications not at all.
// Items in the trash can't be changed until they're restored.

const APPLICATION_FIELDS = [
  'id', 'company', 'role', 'status', 'language', 'font', 'appliedDate', 'interviewDate', 'finalDecisionDate',
  'notes', 'url', 'baseProfileId', 'summaryOverride', 'featuredProjectIds', 'skillGroupsOverride', 'coverLetter', 'fit',
];
// Derived from the status history; changed only through the transitions
// endpoints below. Still listed above so a request naming them gets this
// explanation rather than "unknown field".
const DATE_FIELDS = ['appliedDate', 'interviewDate', 'finalDecisionDate'];
const STATUS_FIELDS_ERROR =
  'The status and the applied/interview/decision dates follow the status history. Change them with ' +
  'POST /api/v1/applications/:id/transitions { to, date? }, undo with DELETE /api/v1/applications/:id/transitions/last, ' +
  'and fix a date with PATCH /api/v1/applications/:id/transitions/:index { date }.';
const BASE_PROFILE_FIELDS = ['id', 'name', 'language', 'profile'];
// Not part of the application: a short note on what a write changed, shown
// in the application's version history like a commit message.
const CHANGE_MESSAGE = 'changeMessage';

/** Takes the change message out of a body, or returns what's wrong with it. */
function takeChangeMessage(body: Body): string | null | string[] {
  const message = body[CHANGE_MESSAGE];
  delete body[CHANGE_MESSAGE];
  if (message === undefined || message === null) return null;
  if (typeof message !== 'string') return [`"${CHANGE_MESSAGE}" must be a string.`];
  return message;
}

// validateApplicationConfig doesn't carry skillGroupsOverride through, so it
// is validated and re-attached here.
function validateApplication(input: Body): Validated<ApplicationConfig> {
  const result = validateApplicationConfig(input);
  const errors = result.ok ? [] : [...result.errors];
  let skillGroups: SkillGroup[] | undefined;
  if (input.skillGroupsOverride !== undefined) {
    const sg = validateSkillGroups(input.skillGroupsOverride);
    if (sg.ok) skillGroups = sg.skillGroups;
    else errors.push(...sg.errors.map((e) => `skillGroupsOverride: ${e}`));
  }
  if (!result.ok || errors.length) return { ok: false, errors };
  return { ok: true, value: { ...result.config, ...(skillGroups && { skillGroupsOverride: skillGroups }) } };
}

// An application may only be pointed at a base profile that exists and isn't
// in the trash; otherwise it would silently render the language default.
function baseProfileIdError(userId: number, body: Body): string | null {
  if (typeof body.baseProfileId !== 'string' || !body.baseProfileId) return null;
  const profile = baseProfiles(userId)?.find((p) => p.id === body.baseProfileId);
  if (!profile) return `"baseProfileId": no base profile "${body.baseProfileId}".`;
  if (profile.deletedAt) return `"baseProfileId": base profile "${body.baseProfileId}" is in the trash.`;
  return null;
}

// New applications start as drafts, so nothing the assistant creates looks
// finished until the user has reviewed it in the app; a job that was only
// checked (/stellencheck) starts as "evaluated" instead.
v1.post('/applications', async (c) => {
  const body = await readBody(c, [...APPLICATION_FIELDS, CHANGE_MESSAGE]);
  if (Array.isArray(body)) return invalid(c, body);
  const message = takeChangeMessage(body);
  if (Array.isArray(message)) return invalid(c, message);
  if (DATE_FIELDS.some((f) => f in body)) return invalid(c, [STATUS_FIELDS_ERROR]);
  if (body.status !== undefined && !INITIAL_STATUSES.includes(body.status as StoredStatus)) {
    return invalid(c, [`"status" of a new application must be ${INITIAL_STATUSES.map((st) => `"${st}"`).join(' or ')}.`]);
  }
  const initial = (body.status as StoredStatus | undefined) ?? 'drafting';
  const result = validateApplication({ ...body, status: initial });
  if (!result.ok) return invalid(c, result.errors);

  const userId = c.get('user').id;
  const profileError = baseProfileIdError(userId, body);
  if (profileError) return invalid(c, [profileError]);
  const explicitId = typeof body.id === 'string' && body.id.trim() !== '';
  if (!result.value.id) return invalid(c, ['Could not derive an id from "company"; pass an "id".']);

  const outcome = transaction(() => {
    const apps = localApps(userId);
    // An id is also taken while edits or a status are stored under it: they
    // may belong to an application from private/applications/, which the
    // server can't see. The API never removes them, so it can't destroy that
    // data by accident; it picks another id instead.
    const taken = new Set([
      ...apps.map((a) => a.id),
      ...idsWithStoredKey(userId, KEYS.appConfig('')),
      ...idsWithStoredKey(userId, KEYS.status('')),
      ...idsWithStoredKey(userId, KEYS.statusHistory('')),
    ]);
    if (explicitId && taken.has(result.value.id)) return null;
    const config = { ...result.value, id: explicitId ? result.value.id : uniqueId(result.value.id, taken) };
    const before = snapshot(userId, [config.id]);
    setJson(userId, KEYS.localApps, [...apps, config]);
    writeHistory(userId, config.id, [{ to: initial, date: null, recordedAt: new Date().toISOString() }]);
    recordChanges(userId, before, authorOf(c), () => message);
    return config;
  });

  if (!outcome) {
    return c.json({ error: `The id "${result.value.id}" is already in use. Pick another one or leave "id" out.` }, 409);
  }
  return c.json(effectiveApplication(userId, outcome), 201);
});

// Partial update: given fields replace the current value, null removes an
// optional one. Saved the way the app's editor saves (the app-config
// override), so the app shows it immediately. Status and dates aren't
// fields here; see the transitions endpoints.
v1.patch('/applications/:id', async (c) => {
  const body = await readBody(c, [...APPLICATION_FIELDS, CHANGE_MESSAGE]);
  if (Array.isArray(body)) return invalid(c, body);
  const message = takeChangeMessage(body);
  if (Array.isArray(message)) return invalid(c, message);
  const id = c.req.param('id');
  if (body.id !== undefined && body.id !== id) return invalid(c, ['"id" cannot be changed.']);
  if (['status', ...DATE_FIELDS].some((f) => f in body)) return invalid(c, [STATUS_FIELDS_ERROR]);

  const userId = c.get('user').id;
  const profileError = baseProfileIdError(userId, body);
  if (profileError) return invalid(c, [profileError]);
  const outcome = transaction((): Validated<null> | 'trashed' | null => {
    const current = findApplication(userId, id);
    if (!current) return null;
    if (current.deletedAt) return 'trashed';
    const { statusHistory: _history, ...rest } = current;
    const merged: Body = { ...rest };
    for (const [key, value] of Object.entries(body)) {
      if (value === null) delete merged[key];
      else merged[key] = value;
    }
    const result = validateApplication(merged);
    if (!result.ok) return result;

    const { status: _status, ...stored } = result.value;
    const before = snapshot(userId, [id]);
    setJson(userId, KEYS.appConfig(id), withoutStatusFields(stored));
    recordChanges(userId, before, authorOf(c), () => message);
    return { ok: true, value: null };
  });

  if (!outcome) return c.json({ error: 'No such application.' }, 404);
  if (outcome === 'trashed') return c.json({ error: 'This application is in the trash. Restore it in the app first.' }, 409);
  if (!outcome.ok) return invalid(c, outcome.errors);
  return c.json(findApplication(userId, id));
});

// ---- Status transitions ----------------------------------------------------
// The status only moves along src/domain/statusMachine.ts's transitions, and
// every step is recorded with its date. An application the server can't see
// (bundled with the app in development) starts from the caller's `expected`.

type HistoryChange =
  | StatusTransition[]
  | { kind: 'invalid'; error: string }
  | { kind: 'conflict'; error: string };

type HistoryOutcome =
  | { kind: 'ok'; app: EffectiveApplication }
  | { kind: 'missing' }
  | { kind: 'trashed' }
  | { kind: 'invalid'; error: string }
  | { kind: 'conflict'; error: string; from: ApplicationStatus };

/** Applies one change to an application's history in a transaction and answers the request. */
function changeHistory(
  c: Context,
  change: (history: StatusTransition[]) => HistoryChange,
  expected?: ApplicationStatus,
) {
  const userId = c.get('user').id;
  const id = c.req.param('id')!;
  const outcome = transaction((): HistoryOutcome => {
    const base = localApps(userId).find((a) => a.id === id);
    if (base?.deletedAt) return { kind: 'trashed' };
    const history = historyFor(userId, id, base, expected);
    if (!history) return { kind: 'missing' };
    const from = currentStatus(history, todayIso());
    if (expected !== undefined && expected !== from) {
      return { kind: 'conflict', from, error: `The status is "${from}" now, not "${expected}". Reload and try again.` };
    }
    const result = change(history);
    if (!Array.isArray(result)) return result.kind === 'conflict' ? { ...result, from } : result;
    writeHistory(userId, id, result);
    const app = findApplication(userId, id);
    return {
      kind: 'ok',
      app: app ?? ({ id, status: currentStatus(result, todayIso()), statusHistory: result } as EffectiveApplication),
    };
  });
  switch (outcome.kind) {
    case 'ok':
      return c.json(outcome.app);
    case 'missing':
      return c.json({ error: 'No such application.' }, 404);
    case 'trashed':
      return c.json({ error: 'This application is in the trash. Restore it in the app first.' }, 409);
    case 'invalid':
      return invalid(c, [outcome.error]);
    case 'conflict':
      return c.json({ error: outcome.error, from: outcome.from, allowed: allowedNext(outcome.from) }, 409);
  }
}

const DATE_ERROR = '"date" must be a date like "2026-11-16".';

v1.post('/applications/:id/transitions', async (c) => {
  const body = await readBody(c, ['to', 'date', 'expected']);
  if (Array.isArray(body)) return invalid(c, body);
  if (!isStoredStatus(body.to)) return invalid(c, ['"to" must be a status other than "ghosted", which is derived.']);
  if (body.date !== undefined && !isIsoDate(body.date)) return invalid(c, [DATE_ERROR]);
  const expected = body.expected;
  if (expected !== undefined && !(isStoredStatus(expected) || expected === 'ghosted')) {
    return invalid(c, ['"expected" must be a status.']);
  }
  const to = body.to;
  const date = (body.date as string | undefined) ?? todayIso();
  return changeHistory(
    c,
    (history) => {
      const result = appendTransition(history, to, date, new Date().toISOString());
      return result.ok ? result.history : { kind: 'conflict', error: result.error };
    },
    expected,
  );
});

v1.delete('/applications/:id/transitions/last', (c) =>
  changeHistory(c, (history) => {
    const result = undoLast(history);
    return result.ok ? result.history : { kind: 'conflict', error: result.error };
  }),
);

v1.patch('/applications/:id/transitions/:index', async (c) => {
  const body = await readBody(c, ['date']);
  if (Array.isArray(body)) return invalid(c, body);
  if (!isIsoDate(body.date)) return invalid(c, [DATE_ERROR]);
  const date = body.date;
  const index = Number(c.req.param('index'));
  return changeHistory(c, (history) => {
    const result = setTransitionDate(history, index, date);
    return result.ok ? result.history : { kind: 'invalid', error: result.error };
  });
});

// ---- Version history -------------------------------------------------------
// Every change to an application's content is kept as a full snapshot (see
// server/history.ts), newest first. Status and notes aren't versioned.

v1.get('/applications/:id/versions', (c) => {
  const userId = c.get('user').id;
  const id = c.req.param('id');
  if (!findApplication(userId, id)) return c.json({ error: 'No such application.' }, 404);
  return c.json(listVersions(userId, id));
});

// Writes the version's content back as the application's saved edits, keeping
// its current status and notes, and records that as a new version, so a
// restore can itself be undone.
v1.post('/applications/:id/versions/:versionId/restore', (c) => {
  const userId = c.get('user').id;
  const id = c.req.param('id');
  const versionId = Number(c.req.param('versionId'));
  const outcome = transaction((): ApplicationConfig | 'no-app' | 'no-version' | 'trashed' => {
    const current = findApplication(userId, id);
    if (!current) return 'no-app';
    if (current.deletedAt) return 'trashed';
    const version = Number.isInteger(versionId) ? getVersion(userId, id, versionId) : null;
    if (!version) return 'no-version';
    const before = snapshot(userId, [id]);
    setJson(userId, KEYS.appConfig(id), { ...version.content, id, ...(current.notes && { notes: current.notes }) });
    const restoredMessage = version.message ? `Restored: ${version.message}` : 'Restored an earlier version';
    recordChanges(userId, before, authorOf(c), () => restoredMessage);
    return findApplication(userId, id)!;
  });

  if (outcome === 'no-app') return c.json({ error: 'No such application.' }, 404);
  if (outcome === 'no-version') return c.json({ error: 'No such version.' }, 404);
  if (outcome === 'trashed') return c.json({ error: 'This application is in the trash. Restore it in the app first.' }, 409);
  return c.json(outcome);
});

function validateBaseProfile(input: Body): Validated<Omit<BaseProfile, 'id'>> {
  const errors: string[] = [];
  if (typeof input.name !== 'string' || !input.name.trim()) errors.push('"name" is required and must be a non-empty string.');
  if (!isAppLanguage(input.language)) errors.push(LANGUAGE_ERROR);
  const profile = validateProfile(input.profile);
  if (!profile.ok) errors.push(...profile.errors.map((e) => `profile: ${e}`));
  if (errors.length || !profile.ok) return { ok: false, errors };
  return {
    ok: true,
    value: { name: (input.name as string).trim(), language: input.language as AppLanguage, profile: profile.profile },
  };
}

const NOT_SEEDED = 'Base profiles are set up the first time the app is opened. Open it once, then retry.';

v1.post('/base-profiles', async (c) => {
  const body = await readBody(c, BASE_PROFILE_FIELDS);
  if (Array.isArray(body)) return invalid(c, body);
  const result = validateBaseProfile(body);
  if (!result.ok) return invalid(c, result.errors);
  const givenId = body.id;
  if (givenId !== undefined && (typeof givenId !== 'string' || !givenId || slugify(givenId) !== givenId)) {
    return invalid(c, ['"id" must be a lowercase slug like "backend-de".']);
  }

  const userId = c.get('user').id;
  const outcome = transaction((): BaseProfile | 'not-seeded' | 'conflict' => {
    // Writing a list before the app seeded it would stop the app from ever
    // adding the default profiles, so this waits for that first run.
    const list = baseProfiles(userId);
    if (!list) return 'not-seeded';
    const taken = new Set(list.map((p) => p.id));
    // Trashed profiles keep their id until purged, so a restore never collides.
    if (givenId !== undefined && taken.has(givenId)) return 'conflict';
    const id = givenId ?? uniqueId(slugify(result.value.name) || 'profile', taken);
    const created: BaseProfile = { id, ...result.value };
    setJson(userId, KEYS.baseProfiles, [...list, created]);
    return created;
  });

  if (outcome === 'not-seeded') return c.json({ error: NOT_SEEDED }, 409);
  if (outcome === 'conflict') return c.json({ error: `A base profile with id "${givenId}" already exists.` }, 409);
  return c.json(outcome, 201);
});

// Full replacement of name, language and profile; the id stays.
v1.put('/base-profiles/:id', async (c) => {
  const body = await readBody(c, BASE_PROFILE_FIELDS);
  if (Array.isArray(body)) return invalid(c, body);
  const id = c.req.param('id');
  if (body.id !== undefined && body.id !== id) return invalid(c, ['"id" cannot be changed.']);
  const result = validateBaseProfile(body);
  if (!result.ok) return invalid(c, result.errors);

  const userId = c.get('user').id;
  const updated = transaction((): BaseProfile | 'not-found' | 'trashed' => {
    const list = baseProfiles(userId);
    const current = list?.find((p) => p.id === id);
    if (!list || !current) return 'not-found';
    if (current.deletedAt) return 'trashed';
    const replacement: BaseProfile = { id, ...result.value };
    setJson(userId, KEYS.baseProfiles, list.map((p) => (p.id === id ? replacement : p)));
    return replacement;
  });

  if (updated === 'not-found') return c.json({ error: 'No such base profile.' }, 404);
  if (updated === 'trashed') return c.json({ error: 'This base profile is in the trash. Restore it first.' }, 409);
  return c.json(updated);
});

// ---- Trash ----------------------------------------------------------------
// The API only soft-deletes base profiles: they move to the trash, where the
// user can restore them or delete them for good in the app, and the server
// purges them after TRASH_RETENTION_DAYS. Applications are trashed only by
// the user in the app; the API just leaves trashed ones out of its lists.

/** Applications not in the trash (with their saved edits) that render with this base profile. */
function applicationsUsing(userId: number, profileId: string): ApplicationConfig[] {
  return localApps(userId)
    .map((a) => effectiveApplication(userId, a))
    .filter((a) => !a.deletedAt && a.baseProfileId === profileId);
}

// Refuses profiles that applications still use: once purged, those would
// silently fall back to the language default profile, changing CVs that may
// already have been sent. Move the applications to another profile first.
v1.delete('/base-profiles/:id', (c) => {
  const id = c.req.param('id');
  const userId = c.get('user').id;
  const outcome = transaction((): BaseProfile | ApplicationConfig[] | null => {
    const list = baseProfiles(userId);
    const current = list?.find((p) => p.id === id);
    if (!list || !current) return null;
    if (current.deletedAt) return current;
    const usedBy = applicationsUsing(userId, id);
    if (usedBy.length) return usedBy;
    const trashed: BaseProfile = { ...current, deletedAt: new Date().toISOString() };
    setJson(userId, KEYS.baseProfiles, list.map((p) => (p.id === id ? trashed : p)));
    return trashed;
  });

  if (!outcome) return c.json({ error: 'No such base profile.' }, 404);
  if (Array.isArray(outcome)) {
    return c.json(
      {
        error: 'This base profile is still used by applications. Point them at another profile first.',
        applications: outcome.map((a) => ({ id: a.id, company: a.company, role: a.role, status: a.status })),
      },
      409,
    );
  }
  return c.json({ ...outcome, purgesAt: purgeDate(outcome.deletedAt!).toISOString() });
});

v1.post('/base-profiles/:id/restore', (c) => {
  const id = c.req.param('id');
  const userId = c.get('user').id;
  const restored = transaction(() => {
    const list = baseProfiles(userId);
    const current = list?.find((p) => p.id === id);
    if (!list || !current) return null;
    const { deletedAt: _deletedAt, ...active } = current;
    if (current.deletedAt) setJson(userId, KEYS.baseProfiles, list.map((p) => (p.id === id ? active : p)));
    return active;
  });

  return restored ? c.json(restored) : c.json({ error: 'No such base profile (it may already have been purged).' }, 404);
});
