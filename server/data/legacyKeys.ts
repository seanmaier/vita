// The old storage keys (shared/storageKeys.ts: local-apps, app-config-<id>,
// status-history-<id>, …), mapped onto the tables. Only data that still comes
// in that format goes through here: the kv rows of a database from before
// tables (./migrate.ts) and backup files (../routes/import.ts). Everything
// else uses the typed functions of each module in this folder.
import { KEY_PREFIXES, STORAGE_KEYS } from '#shared/storageKeys.ts';
import {
  applicationIdsWithData,
  applicationList,
  legacyStatus,
  rawSavedEdits,
  saveApplicationList,
  setLegacyStatus,
  setRawSavedEdits,
} from './applications.ts';
import { baseProfileList, saveBaseProfileList } from './baseProfiles.ts';
import {
  profileOverrideLanguages,
  rawProfileOverride,
  setKnowledgeDoc,
  setRawProfileOverride,
  setSetting,
} from './documents.ts';
import { atomic } from './schema.ts';
import { recordedSteps, saveSteps } from './statusTransitions.ts';
import type { ApplicationConfig, BaseProfile } from '#shared/types.ts';

/** Where a value that couldn't be read is kept, so nothing that was stored is lost. */
export const unreadableKey = (key: string) => `unreadable:${key}`;

type Entry = Record<string, unknown> & { id: string };

function parse(value: string): unknown {
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return undefined;
  }
}

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/**
 * The entries of a stored list that have a string id, each id once (the
 * first wins); `complete` says whether that was all of it.
 */
function listEntries(value: string): { entries: Entry[]; complete: boolean } | null {
  const parsed = parse(value);
  if (!Array.isArray(parsed)) return null;
  const seen = new Set<string>();
  const entries = parsed.filter((e): e is Entry => {
    if (!isObject(e) || typeof e.id !== 'string' || seen.has(e.id)) return false;
    seen.add(e.id);
    return true;
  });
  return { entries, complete: entries.length === parsed.length };
}

/** Stores a value given under its old storage key. */
export function writeLegacyValue(userId: number, key: string, value: string): void {
  atomic(() => {
    const keep = () => setSetting(userId, unreadableKey(key), value);
    const after = (prefix: string) => (key.startsWith(prefix) && key.length > prefix.length ? key.slice(prefix.length) : null);

    if (key === STORAGE_KEYS.localApps || key === STORAGE_KEYS.baseProfiles) {
      const list = listEntries(value);
      if (!list) return keep();
      if (key === STORAGE_KEYS.localApps) saveApplicationList(userId, list.entries as unknown as ApplicationConfig[]);
      else saveBaseProfileList(userId, list.entries as unknown as BaseProfile[]);
      if (!list.complete) keep();
      return;
    }
    // status-history- first: it also starts with status-.
    const historyId = after(KEY_PREFIXES.statusHistory);
    if (historyId !== null) {
      const steps = parse(value);
      if (Array.isArray(steps) && steps.length > 0 && steps.every(isObject)) return saveSteps(userId, historyId, steps);
      return keep();
    }
    const configId = after(KEY_PREFIXES.appConfig);
    if (configId !== null) return setRawSavedEdits(userId, configId, value);
    const statusId = after(KEY_PREFIXES.status);
    if (statusId !== null) return setLegacyStatus(userId, statusId, value);
    const language = after(KEY_PREFIXES.profileOverride);
    if (language !== null) return setRawProfileOverride(userId, language, value);
    const doc = after(KEY_PREFIXES.knowledge);
    if (doc !== null) return setKnowledgeDoc(userId, doc, value);
    setSetting(userId, key, value);
  });
}

/**
 * The user's applications, status histories and profiles under their old
 * storage keys: what shared/domain/backupMerge.ts merges a backup file into.
 */
export function legacyView(userId: number): Record<string, string> {
  const view: Record<string, string> = { [STORAGE_KEYS.localApps]: JSON.stringify(applicationList(userId)) };
  const profiles = baseProfileList(userId);
  if (profiles) view[STORAGE_KEYS.baseProfiles] = JSON.stringify(profiles);
  for (const id of applicationIdsWithData(userId)) {
    const edits = rawSavedEdits(userId, id);
    if (edits !== null) view[STORAGE_KEYS.appConfig(id)] = edits;
    const status = legacyStatus(userId, id);
    if (status !== null) view[STORAGE_KEYS.status(id)] = status;
    const steps = recordedSteps(userId, id);
    if (steps) view[STORAGE_KEYS.statusHistory(id)] = JSON.stringify(steps);
  }
  for (const language of profileOverrideLanguages(userId)) {
    view[STORAGE_KEYS.profileOverride(language)] = rawProfileOverride(userId, language)!;
  }
  return view;
}
