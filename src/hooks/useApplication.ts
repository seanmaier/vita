import type { ApplicationConfig } from '#shared/types.ts';
import { effectiveApp, useApplicationMutations, type AppRecord } from '../api/applications';

type Callbacks = { onSuccess?: () => void; onError?: (e: Error) => void };

/** One application with its saved edits applied, and saving or resetting those edits. */
export function useApplication(record: AppRecord) {
  const { saveEdits, resetEdits } = useApplicationMutations();
  const id = record.app.id;

  /** `message` optionally says what changed; it shows in the application's version history. */
  const save = (updated: Omit<ApplicationConfig, 'status'>, message = '', callbacks?: Callbacks) =>
    saveEdits.mutate({ id, config: { ...updated, id }, message: message.trim() || undefined }, callbacks);

  /** Back to the application as it was created or imported. */
  const reset = (callbacks?: Callbacks) => resetEdits.mutate(id, callbacks);

  return {
    app: effectiveApp(record),
    save,
    reset,
    isDirty: record.savedEdits !== null,
    isSaving: saveEdits.isPending || resetEdits.isPending,
  };
}
