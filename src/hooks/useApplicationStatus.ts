import { useState } from 'react';
import { changeStatus, changeStepDate, historyOf, statusOf, type StatusAction } from '../utils/statusTransitions';
import type { ApplicationConfig } from '#shared/types.ts';

const showError = (e: unknown) => alert(e instanceof Error ? e.message : String(e));

/** An application's status history, its current status, and the ways to change them (refusals are shown to the user). */
export function useApplicationStatus(app: ApplicationConfig) {
  const [history, setHistory] = useState(() => historyOf(app));

  const act = (action: StatusAction) => {
    changeStatus(app.id, history, action).then(setHistory, showError);
  };
  const changeDate = (index: number, date: string) => {
    changeStepDate(app.id, history, index, date).then(setHistory, showError);
  };

  return { history, status: statusOf(history), act, changeDate };
}
