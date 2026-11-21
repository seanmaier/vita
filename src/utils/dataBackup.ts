import type { BaseProfile } from '#shared/types.ts';
import { mergeBackup, type DataBackup } from '#shared/domain/backupMerge.ts';
import { isDemo } from '../demo/demoMode';
import { client, errorFrom } from './apiClient';
import { storage, flush } from './storage';
import type { ProfileOverrides, StoredApplication } from '../api/backend';

export type { DataBackup } from '#shared/domain/backupMerge.ts';
export { parseBackup, type ParseBackupResult } from '#shared/domain/backupMerge.ts';

/** What the backup is made of, as the data queries hold it. */
export interface BackupSource {
  /** The whole list, trash included, so importing keeps trashed ones restorable. */
  baseProfiles: BaseProfile[];
  applications: StoredApplication[];
  profileOverrides: ProfileOverrides;
}

/**
 * Gathers every application, status history, saved edit, base profile, and
 * profile customization stored for the logged-in user.
 */
export function exportAllData({ baseProfiles, applications, profileOverrides }: BackupSource): DataBackup {
  const statusHistories: DataBackup['statusHistories'] = {};
  const configOverrides: DataBackup['configOverrides'] = {};
  for (const { id, savedEdits, statusHistory } of applications) {
    if (statusHistory) statusHistories[id] = statusHistory;
    if (savedEdits) configOverrides[id] = savedEdits;
  }
  return {
    version: 3,
    exportedAt: new Date().toISOString(),
    localApps: applications.flatMap((a) => (a.config ? [a.config] : [])),
    statusHistories,
    configOverrides,
    profileOverrides,
    baseProfiles,
  };
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
  const res = await client.api.import.$post({ json: backup });
  if (!res.ok) throw await errorFrom(res, 'Import failed');
  return res.json();
}
