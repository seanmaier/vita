// The data backend for the demo and component tests: everything stays in this
// browser tab (src/utils/storage.ts, which the demo writes to sessionStorage),
// under the same storage keys and with the same behaviour as the server routes.
import type { ApplicationConfig, BaseProfile, Profile, StatusTransition } from '#shared/types.ts';
import { seedHistory, validateHistory, type HistoryResult } from '#shared/domain/statusMachine.ts';
import { LANGUAGES } from '#shared/utils/language.ts';
import { KEY_PREFIXES, STORAGE_KEYS } from '#shared/storageKeys.ts';
import { storage } from '../utils/storage';
import { applyAction, applyStepDate } from '../utils/statusTransitions';
import type { DataBackend, ProfileOverrides, Settings, StoredApplication, StoredConfig } from './backend';

function readJson<T>(key: string): T | null {
  try {
    const raw = storage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

const writeJson = (key: string, value: unknown) => storage.setItem(key, JSON.stringify(value));

// ---- Base profiles ----------------------------------------------------------------

function changeProfiles(change: (list: BaseProfile[]) => BaseProfile[] | null): Promise<BaseProfile[]> {
  const next = change(readJson<BaseProfile[]>(STORAGE_KEYS.baseProfiles) ?? []);
  if (!next) return Promise.reject(new Error('No such base profile.'));
  writeJson(STORAGE_KEYS.baseProfiles, next);
  return Promise.resolve(next);
}

const known = (list: { id: string }[], id: string) => list.some((p) => p.id === id);

function withoutDeletedAt<T extends { deletedAt?: string }>(item: T): T {
  const { deletedAt: _deletedAt, ...rest } = item;
  return rest as T;
}

const settings = (): Settings => ({ tourSeen: storage.getItem(STORAGE_KEYS.tourSeen) !== null });

// ---- Applications -----------------------------------------------------------------

const localApps = () => readJson<ApplicationConfig[]>(STORAGE_KEYS.localApps) ?? [];

function idsWithPrefix(prefix: string): string[] {
  return storage
    .keys()
    .filter((key) => key.startsWith(prefix))
    .map((key) => key.slice(prefix.length));
}

/** Like server/routes/applications.ts: list entries first, then any others with saved edits or a status. */
function storedApplications(): StoredApplication[] {
  const entries = localApps();
  // status-<id> keys only; status-history-<id> starts with status- too.
  const legacyIds = storage
    .keys()
    .filter((key) => key.startsWith(KEY_PREFIXES.status) && !key.startsWith(KEY_PREFIXES.statusHistory))
    .map((key) => key.slice(KEY_PREFIXES.status.length));
  const ids = [
    ...new Set([
      ...entries.map((a) => a.id),
      ...idsWithPrefix(KEY_PREFIXES.appConfig),
      ...idsWithPrefix(KEY_PREFIXES.statusHistory),
      ...legacyIds,
    ]),
  ];
  return ids.map((id) => {
    const config = entries.find((a) => a.id === id) ?? null;
    const savedEdits = readJson<StoredConfig>(STORAGE_KEYS.appConfig(id));
    const recorded = validateHistory(readJson(STORAGE_KEYS.statusHistory(id)));
    const legacy = storage.getItem(STORAGE_KEYS.status(id)) as ApplicationConfig['status'] | null;
    const status = legacy ?? config?.status;
    const statusHistory = recorded.ok
      ? recorded.history
      : status
        ? seedHistory(status, savedEdits ?? config ?? {})
        : null;
    return { id, config, savedEdits, statusHistory };
  });
}

const answer = () => Promise.resolve(storedApplications());

function changeEntry(id: string, change: (a: ApplicationConfig) => ApplicationConfig): Promise<StoredApplication[]> {
  const entries = localApps();
  if (!known(entries, id)) return Promise.reject(new Error('No such application.'));
  writeJson(
    STORAGE_KEYS.localApps,
    entries.map((a) => (a.id === id ? change(a) : a)),
  );
  return answer();
}

function step(id: string, result: HistoryResult): Promise<StatusTransition[]> {
  if (!result.ok) return Promise.reject(new Error(result.error));
  writeJson(STORAGE_KEYS.statusHistory(id), result.history);
  return Promise.resolve(result.history);
}

export const localBackend: DataBackend = {
  applications: {
    list: answer,
    save: (config) => {
      const entries = localApps();
      writeJson(
        STORAGE_KEYS.localApps,
        known(entries, config.id) ? entries.map((a) => (a.id === config.id ? config : a)) : [...entries, config],
      );
      return answer();
    },
    saveEdits: (id, config) => {
      writeJson(STORAGE_KEYS.appConfig(id), config);
      return answer();
    },
    resetEdits: (id) => {
      storage.removeItem(STORAGE_KEYS.appConfig(id));
      return answer();
    },
    trash: (id) => {
      const deletedAt = new Date().toISOString();
      return changeEntry(id, (a) => ({ ...a, deletedAt }));
    },
    restore: (id) => changeEntry(id, withoutDeletedAt),
    remove: (id) => {
      const entries = localApps();
      if (!known(entries, id)) return Promise.reject(new Error('No such application.'));
      writeJson(
        STORAGE_KEYS.localApps,
        entries.filter((a) => a.id !== id),
      );
      for (const key of [STORAGE_KEYS.appConfig(id), STORAGE_KEYS.status(id), STORAGE_KEYS.statusHistory(id)]) {
        storage.removeItem(key);
      }
      return answer();
    },
    changeStatus: (id, history, action) => step(id, applyAction(history, action)),
    changeStepDate: (id, history, index, date) => step(id, applyStepDate(history, index, date)),
  },
  baseProfiles: {
    list: () => Promise.resolve(readJson<BaseProfile[]>(STORAGE_KEYS.baseProfiles)),
    seed: (defaults) => {
      const current = readJson<BaseProfile[]>(STORAGE_KEYS.baseProfiles);
      return current ? Promise.resolve(current) : changeProfiles(() => defaults);
    },
    save: (profile) =>
      changeProfiles((list) =>
        known(list, profile.id) ? list.map((p) => (p.id === profile.id ? profile : p)) : [...list, profile],
      ),
    trash: (id) => {
      const deletedAt = new Date().toISOString();
      return changeProfiles((list) =>
        known(list, id) ? list.map((p) => (p.id === id ? { ...p, deletedAt } : p)) : null,
      );
    },
    restore: (id) =>
      changeProfiles((list) => (known(list, id) ? list.map((p) => (p.id === id ? withoutDeletedAt(p) : p)) : null)),
    remove: (id) => changeProfiles((list) => (known(list, id) ? list.filter((p) => p.id !== id) : null)),
  },
  profileOverrides: {
    list: () => {
      const overrides: ProfileOverrides = {};
      for (const language of LANGUAGES) {
        const profile = readJson<Profile>(STORAGE_KEYS.profileOverride(language));
        if (profile) overrides[language] = profile;
      }
      return Promise.resolve(overrides);
    },
  },
  settings: {
    get: () => Promise.resolve(settings()),
    markTourSeen: () => {
      storage.setItem(STORAGE_KEYS.tourSeen, '1');
      return Promise.resolve(settings());
    },
  },
};
