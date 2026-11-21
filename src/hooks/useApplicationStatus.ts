import { useApplicationMutations, type AppRecord } from '../api/applications';
import { statusOf, type StatusAction } from '../utils/statusTransitions';

const showError = (e: Error) => alert(e.message);

/** An application's status history, its current status, and the ways to change them (refusals are shown to the user). */
export function useApplicationStatus(record: AppRecord) {
  const { changeStatus, changeStepDate } = useApplicationMutations();
  const { id } = record.app;
  const { history } = record;

  const act = (action: StatusAction) => changeStatus.mutate({ id, history, action }, { onError: showError });
  const changeDate = (index: number, date: string) =>
    changeStepDate.mutate({ id, history, index, date }, { onError: showError });

  return { history, status: statusOf(history), act, changeDate };
}
