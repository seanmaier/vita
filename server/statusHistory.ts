// Each application's status history (see
// shared/domain/statusMachine.ts). Applications without one yet, such as data
// from before the history existed, read as a history seeded from the old
// single status and date fields, so every reader sees the same status.
import { seedHistory, validateHistory } from '#shared/domain/statusMachine.ts';
import type { ApplicationConfig, ApplicationStatus, StatusTransition } from '#shared/types.ts';
import { legacyStatus, savedEdits } from './data/applications.ts';
import { recordedSteps, saveSteps } from './data/statusTransitions.ts';

/** The recorded history, or null if there is none (or it's unreadable). */
export function storedHistory(userId: number, appId: string): StatusTransition[] | null {
  const raw = recordedSteps(userId, appId);
  if (raw === null) return null;
  const result = validateHistory(raw);
  return result.ok ? result.history : null;
}

/**
 * The application's history: recorded, or seeded from what the server knows
 * about it (its single stored status, else the status on `base`, else
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
  const status = legacyStatus(userId, appId) ?? base?.status ?? fallback;
  if (!status) return null;
  return seedHistory(status, savedEdits(userId, appId) ?? base ?? {});
}

export function writeHistory(userId: number, appId: string, history: StatusTransition[]): void {
  saveSteps(userId, appId, history);
}
