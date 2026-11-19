// Applications as server state: cached by TanStack Query, refetched when the
// tab comes back into view, and updated from each write's answer.
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { ApplicationConfig, StatusTransition } from '#shared/types.ts';
import { normalizeNotes } from '#shared/utils/notes.ts';
import { applications as bundledApplications } from '../data/applications';
import { historyOf, statusOf, type StatusAction } from '../utils/statusTransitions';
import { useBackend, type StoredApplication, type StoredConfig } from './backend';

export const applicationsKey = ['applications'] as const;

/** One application as the app works with it. */
export interface AppRecord {
  /** Its list entry, or the bundled config for one from private/applications/. */
  app: ApplicationConfig;
  /** The edits saved over it ("Reset to default" drops them). */
  savedEdits: StoredConfig | null;
  history: StatusTransition[];
}

/** The application with its saved edits applied and its status from the history. */
export function effectiveApp(record: AppRecord): ApplicationConfig {
  const { app, savedEdits, history } = record;
  return { ...app, ...savedEdits, id: app.id, deletedAt: app.deletedAt, status: statusOf(history) };
}

function withNotes<T extends { notes?: unknown }>(config: T): T {
  return { ...config, notes: normalizeNotes(config.notes) };
}

/** Bundled applications first, then the user's list, each with its saved edits and history. */
function toRecords(stored: StoredApplication[]): AppRecord[] {
  const byId = new Map(stored.map((s) => [s.id, s]));
  const record = (app: ApplicationConfig): AppRecord => {
    const s = byId.get(app.id);
    const savedEdits = s?.savedEdits ? withNotes(s.savedEdits) : null;
    return { app: withNotes(app), savedEdits, history: historyOf(app, s?.statusHistory ?? null, savedEdits) };
  };
  const listed = stored.flatMap((s) => (s.config ? [s.config] : []));
  const bundled = bundledApplications.filter((app) => !listed.some((a) => a.id === app.id));
  return [...bundled, ...listed].map(record);
}

/** Every application, trash included. */
export function useApplications() {
  const backend = useBackend().applications;
  return useQuery({ queryKey: applicationsKey, queryFn: backend.list, select: toRecords });
}

/** The applications as stored, without the bundled ones (for the backup). */
export function useStoredApplications() {
  const backend = useBackend().applications;
  return useQuery({ queryKey: applicationsKey, queryFn: backend.list });
}

/** All writes; each puts its answer into the cache. */
export function useApplicationMutations() {
  const backend = useBackend().applications;
  const queryClient = useQueryClient();
  const onSuccess = (stored: StoredApplication[]) => queryClient.setQueryData(applicationsKey, stored);
  const setHistory = (id: string, statusHistory: StatusTransition[]) =>
    queryClient.setQueryData<StoredApplication[]>(applicationsKey, (stored = []) =>
      stored.some((s) => s.id === id)
        ? stored.map((s) => (s.id === id ? { ...s, statusHistory } : s))
        : [...stored, { id, config: null, savedEdits: null, statusHistory }],
    );
  return {
    save: useMutation({ mutationFn: backend.save, onSuccess }),
    saveEdits: useMutation({
      mutationFn: ({ id, config, message }: { id: string; config: StoredConfig; message?: string }) =>
        backend.saveEdits(id, config, message),
      onSuccess,
    }),
    resetEdits: useMutation({ mutationFn: backend.resetEdits, onSuccess }),
    trash: useMutation({ mutationFn: backend.trash, onSuccess }),
    restore: useMutation({ mutationFn: backend.restore, onSuccess }),
    remove: useMutation({ mutationFn: backend.remove, onSuccess }),
    changeStatus: useMutation({
      mutationFn: ({ id, history, action }: { id: string; history: StatusTransition[]; action: StatusAction }) =>
        backend.changeStatus(id, history, action),
      onSuccess: (history, { id }) => setHistory(id, history),
    }),
    changeStepDate: useMutation({
      mutationFn: ({
        id,
        history,
        index,
        date,
      }: {
        id: string;
        history: StatusTransition[];
        index: number;
        date: string;
      }) => backend.changeStepDate(id, history, index, date),
      onSuccess: (history, { id }) => setHistory(id, history),
    }),
  };
}
