// The app's side of the status state machine (src/domain/statusMachine.ts):
// reading an application's history and changing it. Changes go through the
// server's transitions API, which enforces the rules; in the demo, which never
// talks to the server, the same pure functions run on this tab's storage.
import type { ApplicationConfig, ApplicationStatus, StatusTransition, StoredStatus } from '../types';
import {
  appendTransition,
  currentStatus,
  seedHistory,
  setTransitionDate,
  undoLast,
  validateHistory,
  type HistoryResult,
} from '../domain/statusMachine';
import { isDemo } from '../demo/demoMode';
import { errorFrom } from './api';
import { getConfigOverride } from './appStorage';
import { todayIso } from './date';
import { storage } from './storage';

const historyKey = (appId: string) => `status-history-${appId}`;

/** What a status picker can ask for: a next status, or undoing the last step. */
export type StatusAction = StoredStatus | 'undo';

/**
 * The application's status history: the recorded one, or for data from before
 * histories existed, one seeded from the old status and date fields (like the
 * server reads it).
 */
export function historyOf(app: ApplicationConfig): StatusTransition[] {
  const raw = storage.getItem(historyKey(app.id));
  if (raw !== null) {
    try {
      const recorded = validateHistory(JSON.parse(raw));
      if (recorded.ok) return recorded.history;
    } catch {
      // unreadable: fall back to the old fields below
    }
  }
  const legacyStatus = storage.getItem(`status-${app.id}`) as ApplicationStatus | null;
  return seedHistory(legacyStatus ?? app.status, getConfigOverride(app.id) ?? app);
}

export function statusOf(history: StatusTransition[]): ApplicationStatus {
  return currentStatus(history, todayIso());
}

async function request(appId: string, path: string, init: RequestInit): Promise<StatusTransition[]> {
  const res = await fetch(`/api/v1/applications/${encodeURIComponent(appId)}/transitions${path}`, {
    ...init,
    headers: { 'Content-Type': 'application/json' },
  });
  if (!res.ok) throw await errorFrom(res, 'Changing the status failed');
  const body = (await res.json()) as { statusHistory: StatusTransition[] };
  // The server already has it; only the in-memory copy needs updating.
  storage.setLocal(historyKey(appId), JSON.stringify(body.statusHistory));
  return body.statusHistory;
}

function applyLocally(appId: string, result: HistoryResult): StatusTransition[] {
  if (!result.ok) throw new Error(result.error);
  storage.setItem(historyKey(appId), JSON.stringify(result.history));
  return result.history;
}

/** Performs a status action; resolves with the new history or rejects with a message to show. */
export function changeStatus(
  appId: string,
  history: StatusTransition[],
  action: StatusAction,
): Promise<StatusTransition[]> {
  if (action === 'undo') {
    if (isDemo) return Promise.resolve().then(() => applyLocally(appId, undoLast(history)));
    return request(appId, '/last', { method: 'DELETE' });
  }
  const date = todayIso();
  if (isDemo)
    return Promise.resolve().then(() =>
      applyLocally(appId, appendTransition(history, action, date, new Date().toISOString())),
    );
  return request(appId, '', {
    method: 'POST',
    body: JSON.stringify({ to: action, date, expected: statusOf(history) }),
  });
}

/** Changes when step `index` of the history happened. */
export function changeStepDate(
  appId: string,
  history: StatusTransition[],
  index: number,
  date: string,
): Promise<StatusTransition[]> {
  if (isDemo) return Promise.resolve().then(() => applyLocally(appId, setTransitionDate(history, index, date)));
  return request(appId, `/${index}`, { method: 'PATCH', body: JSON.stringify({ date }) });
}
