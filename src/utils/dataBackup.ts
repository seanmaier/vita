import type { ApplicationConfig, ApplicationStatus, AppLanguage, Profile, StatusTransition } from '../types';
import { BACKUP_KEYS, mergeBackup, type DataBackup } from '../domain/backupMerge';
import { seedHistory, validateHistory } from '../domain/statusMachine';
import { isDemo } from '../demo/demoMode';
import { errorFrom } from './api';
import { storage, flush } from './storage';
import { getAllBaseProfiles } from './baseProfiles';

export type { DataBackup } from '../domain/backupMerge';
export { parseBackup, type ParseBackupResult } from '../domain/backupMerge';

function parse<T>(raw: string | null): T | null {
  if (raw === null) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null; // skip corrupt entries
  }
}

/** Gathers every application, status history, saved edit, base profile, and profile customization stored for the logged-in user. */
export function exportAllData(): DataBackup {
  const localApps = parse<ApplicationConfig[]>(storage.getItem(BACKUP_KEYS.localApps)) ?? [];
  const statusHistories: Record<string, StatusTransition[]> = {};
  const legacyStatuses: Record<string, ApplicationStatus> = {};
  const configOverrides: DataBackup['configOverrides'] = {};
  const profileOverrides: Partial<Record<AppLanguage, Profile>> = {};

  for (const key of storage.keys()) {
    const raw = storage.getItem(key);
    if (key.startsWith(BACKUP_KEYS.statusHistory)) {
      const history = validateHistory(parse(raw));
      if (history.ok) statusHistories[key.slice(BACKUP_KEYS.statusHistory.length)] = history.history;
    } else if (key.startsWith(BACKUP_KEYS.status) && raw) {
      legacyStatuses[key.slice(BACKUP_KEYS.status.length)] = raw as ApplicationStatus;
    } else if (key.startsWith(BACKUP_KEYS.appConfig)) {
      const config = parse<DataBackup['configOverrides'][string]>(raw);
      if (config) configOverrides[key.slice(BACKUP_KEYS.appConfig.length)] = config;
    } else if (key.startsWith(BACKUP_KEYS.profileOverride)) {
      const profile = parse<Profile>(raw);
      if (profile) profileOverrides[key.slice(BACKUP_KEYS.profileOverride.length) as AppLanguage] = profile;
    }
  }
  // Applications still without a recorded history export the one they read as.
  for (const [id, status] of Object.entries(legacyStatuses)) {
    if (!statusHistories[id]) statusHistories[id] = seedHistory(status, configOverrides[id] ?? localApps.find((a) => a.id === id) ?? {});
  }

  // Goes through getAllBaseProfiles so an account that never opened the profiles
  // page still exports the profiles it would show (seeded from the legacy ones).
  // Trashed profiles are included, so importing keeps them restorable.
  const baseProfiles = getAllBaseProfiles();

  return { version: 3, exportedAt: new Date().toISOString(), localApps, statusHistories, configOverrides, profileOverrides, baseProfiles };
}

/** Triggers a browser download of the backup as a .json file — works the same in Chrome and Firefox. */
export function downloadBackup(backup: DataBackup): void {
  const blob = new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `vita-backup-${backup.exportedAt.slice(0, 10)}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export interface ImportSummary {
  added: string[];
  skipped: string[];
  addedProfiles: string[];
}

/**
 * Adds a backup to the account without overwriting anything: the server
 * merges it, or, in the demo, the same merge runs on this tab's storage.
 * The caller reloads the page afterwards to read the result.
 */
export async function importBackup(backup: DataBackup): Promise<ImportSummary> {
  if (isDemo) {
    const current = Object.fromEntries(storage.keys().map((k) => [k, storage.getItem(k) ?? '']));
    const result = mergeBackup(current, backup);
    if (!result.ok) throw new Error(result.error);
    for (const [key, value] of Object.entries(result.set)) storage.setItem(key, value);
    await flush();
    return result;
  }
  // Pending edits first, so the server merges against the current state.
  await flush();
  const res = await fetch('/api/import', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(backup),
  });
  if (!res.ok) throw await errorFrom(res, 'Import failed');
  return res.json();
}
