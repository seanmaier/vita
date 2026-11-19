// Backup files and how importing one adds to an account: anything the account
// doesn't have yet is added, nothing it has is overwritten. Pure functions
// over the account's raw kv entries, so the server (POST /api/import) and the
// demo (which never talks to the server) merge the same way.
import { KEY_PREFIXES, STORAGE_KEYS } from '#shared/storageKeys.ts';
import type {
  AppLanguage,
  ApplicationConfig,
  ApplicationStatus,
  BaseProfile,
  Profile,
  StatusTransition,
} from '#shared/types.ts';
import { seedHistory, validateHistory } from '#shared/domain/statusMachine.ts';

type StoredConfig = Omit<ApplicationConfig, 'status'>;

export interface DataBackup {
  version: 3;
  exportedAt: string;
  localApps: ApplicationConfig[];
  statusHistories: Record<string, StatusTransition[]>;
  configOverrides: Record<string, StoredConfig>;
  profileOverrides: Partial<Record<AppLanguage, Profile>>;
  baseProfiles?: BaseProfile[];
  /** Only in version 1 and 2 files, which predate status histories. */
  statuses?: Record<string, ApplicationStatus>;
}

/** The keys a backup reads and writes: whole lists, and prefixes of per-id keys. */
export const BACKUP_KEYS = {
  localApps: STORAGE_KEYS.localApps,
  baseProfiles: STORAGE_KEYS.baseProfiles,
  appConfig: KEY_PREFIXES.appConfig,
  status: KEY_PREFIXES.status,
  statusHistory: KEY_PREFIXES.statusHistory,
  profileOverride: KEY_PREFIXES.profileOverride,
};

export type ParseBackupResult = { ok: true; backup: DataBackup } | { ok: false; error: string };

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/** Parses and structurally checks a backup file of any version (1–3). */
export function parseBackup(raw: string): ParseBackupResult {
  let p: unknown;
  try {
    p = JSON.parse(raw);
  } catch (e) {
    return { ok: false, error: `Invalid JSON: ${(e as SyntaxError).message}` };
  }
  return parseBackupValue(p);
}

export function parseBackupValue(p: unknown): ParseBackupResult {
  const invalid = (what: string): ParseBackupResult => ({ ok: false, error: `Not a valid backup file — ${what}.` });
  if (!isObject(p)) return { ok: false, error: 'Expected a JSON object.' };
  if (!Array.isArray(p.localApps)) return invalid('missing "localApps" array');
  const hasHistories = isObject(p.statusHistories);
  if (!hasHistories && !isObject(p.statuses))
    return invalid('missing "statusHistories" (or, in older files, "statuses")');
  if (!isObject(p.configOverrides)) return invalid('missing "configOverrides" object');
  if (!isObject(p.profileOverrides)) return invalid('missing "profileOverrides" object');
  if (p.baseProfiles !== undefined && !Array.isArray(p.baseProfiles)) return invalid('"baseProfiles" must be an array');
  return {
    ok: true,
    backup: {
      version: 3,
      exportedAt: typeof p.exportedAt === 'string' ? p.exportedAt : new Date().toISOString(),
      localApps: p.localApps as ApplicationConfig[],
      statusHistories: hasHistories ? (p.statusHistories as Record<string, StatusTransition[]>) : {},
      configOverrides: p.configOverrides as Record<string, StoredConfig>,
      profileOverrides: p.profileOverrides as Partial<Record<AppLanguage, Profile>>,
      baseProfiles: p.baseProfiles as BaseProfile[] | undefined,
      ...(!hasHistories && { statuses: p.statuses as Record<string, ApplicationStatus> }),
    },
  };
}

export type MergeResult =
  | { ok: true; set: Record<string, string>; added: string[]; skipped: string[]; addedProfiles: string[] }
  | { ok: false; error: string };

function parse<T>(raw: string | undefined): T | null {
  if (raw === undefined) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

/** Ids the account already uses for an application in any form. */
function takenIds(current: Record<string, string>): Set<string> {
  const ids = new Set((parse<ApplicationConfig[]>(current[BACKUP_KEYS.localApps]) ?? []).map((a) => a.id));
  for (const key of Object.keys(current)) {
    for (const prefix of [BACKUP_KEYS.statusHistory, BACKUP_KEYS.status, BACKUP_KEYS.appConfig]) {
      if (key.startsWith(prefix)) {
        ids.add(key.slice(prefix.length));
        break;
      }
    }
  }
  return ids;
}

/**
 * The kv writes that add a backup to an account. Applications are added only
 * under ids the account doesn't use yet; the rest are skipped, never
 * overwritten. Base profiles and legacy profile overrides likewise.
 */
export function mergeBackup(current: Record<string, string>, backup: DataBackup): MergeResult {
  const set: Record<string, string> = {};
  const taken = takenIds(current);
  const entries = new Map(backup.localApps.map((a) => [a.id, a]));
  const ids = [
    ...new Set([
      ...entries.keys(),
      ...Object.keys(backup.configOverrides),
      ...Object.keys(backup.statusHistories),
      ...Object.keys(backup.statuses ?? {}),
    ]),
  ];

  const added: string[] = [];
  const skipped: string[] = [];
  const list = parse<ApplicationConfig[]>(current[BACKUP_KEYS.localApps]) ?? [];
  for (const id of ids) {
    if (taken.has(id)) {
      skipped.push(id);
      continue;
    }
    const entry = entries.get(id);
    const override = backup.configOverrides[id];
    let history: StatusTransition[] | null = null;
    if (backup.statusHistories[id] !== undefined) {
      const checked = validateHistory(backup.statusHistories[id]);
      if (!checked.ok) return { ok: false, error: `The status history of "${id}" is invalid: ${checked.error}` };
      history = checked.history;
    } else {
      const status = backup.statuses?.[id] ?? entry?.status;
      if (status) history = seedHistory(status, override ?? entry ?? {});
    }
    if (entry) list.push(entry);
    if (override) set[`${BACKUP_KEYS.appConfig}${id}`] = JSON.stringify(override);
    if (history) set[`${BACKUP_KEYS.statusHistory}${id}`] = JSON.stringify(history);
    added.push(id);
  }
  if (added.some((id) => entries.has(id))) set[BACKUP_KEYS.localApps] = JSON.stringify(list);

  const addedProfiles: string[] = [];
  if (backup.baseProfiles) {
    const profiles = parse<BaseProfile[]>(current[BACKUP_KEYS.baseProfiles]) ?? [];
    const known = new Set(profiles.map((p) => p.id));
    for (const p of backup.baseProfiles) {
      if (known.has(p.id)) continue;
      profiles.push(p);
      known.add(p.id);
      addedProfiles.push(p.id);
    }
    if (addedProfiles.length) set[BACKUP_KEYS.baseProfiles] = JSON.stringify(profiles);
  }

  for (const [lang, profile] of Object.entries(backup.profileOverrides)) {
    const key = `${BACKUP_KEYS.profileOverride}${lang}`;
    if (current[key] === undefined && profile) set[key] = JSON.stringify(profile);
  }

  return { ok: true, set, added, skipped, addedProfiles };
}
