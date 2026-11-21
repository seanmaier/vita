// Each application's status history (kv `status-history-<id>`, see
// shared/domain/statusMachine.ts). Applications without one yet, such as data
// from before the history existed, read as a history seeded from the old
// `status-<id>` value and date fields, so every reader sees the same status.
import { seedHistory, validateHistory } from '#shared/domain/statusMachine.ts';
import type { ApplicationConfig, ApplicationStatus, StatusTransition } from '#shared/types.ts';
import { getJson, getValue, KEYS, setJson } from './store.ts';

type StoredConfig = Omit<ApplicationConfig, 'status'>;

/** The recorded history, or null if there is none (or it's unreadable). */
export function storedHistory(userId: number, appId: string): StatusTransition[] | null {
  const raw = getJson<unknown>(userId, KEYS.statusHistory(appId));
  if (raw === null) return null;
  const result = validateHistory(raw);
  return result.ok ? result.history : null;
}

/**
 * The application's history: recorded, or seeded from what the server knows
 * about it (its `status-<id>` value, else the status on `base`, else
 * `fallback`). Null when the server knows no status for it at all.
 */
export function historyFor(
  userId: number,
  appId: string,
  base?: ApplicationConfig,
  fallback?: ApplicationStatus,
): StatusTransition[] | null {
  const stored = storedHistory(userId, appId);
  if (stored) return stored;
  const status = (getValue(userId, KEYS.status(appId)) as ApplicationStatus | null) ?? base?.status ?? fallback;
  if (!status) return null;
  const override = getJson<StoredConfig>(userId, KEYS.appConfig(appId));
  return seedHistory(status, override ?? base ?? {});
}

export function writeHistory(userId: number, appId: string, history: StatusTransition[]): void {
  setJson(userId, KEYS.statusHistory(appId), history);
}
