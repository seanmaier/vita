// The app's side of the status state machine (shared/domain/statusMachine.ts):
// reading an application's history and working out a step. Steps are taken
// through the data backend (src/api/backend.ts): the server's transitions API
// enforces the rules, and the demo runs the same pure functions in the tab.
import type { ApplicationConfig, ApplicationStatus, StatusTransition, StoredStatus } from '#shared/types.ts';
import {
  appendTransition,
  currentStatus,
  seedHistory,
  setTransitionDate,
  undoLast,
  type HistoryResult,
} from '#shared/domain/statusMachine.ts';
import { todayIso } from '#shared/utils/date.ts';

/** What a status picker can ask for: a next status, or undoing the last step. */
export type StatusAction = StoredStatus | 'undo';

/**
 * The application's status history: the recorded one, or for an application
 * the server knows nothing about yet (one bundled with the app), one seeded
 * from its status and date fields.
 */
export function historyOf(
  app: ApplicationConfig,
  recorded: StatusTransition[] | null,
  savedEdits: Partial<ApplicationConfig> | null,
): StatusTransition[] {
  return recorded ?? seedHistory(app.status, savedEdits ?? app);
}

export function statusOf(history: StatusTransition[]): ApplicationStatus {
  return currentStatus(history, todayIso());
}

/** The history after `action`, worked out locally (the demo); the server does the same. */
export function applyAction(history: StatusTransition[], action: StatusAction): HistoryResult {
  if (action === 'undo') return undoLast(history);
  return appendTransition(history, action, todayIso(), new Date().toISOString());
}

/** The history with step `index` dated `date`, worked out locally. */
export function applyStepDate(history: StatusTransition[], index: number, date: string): HistoryResult {
  return setTransitionDate(history, index, date);
}
