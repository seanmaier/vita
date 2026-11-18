import { allowedNext } from '../domain/statusMachine';
import { STATUS_LABELS } from '../utils/status';
import type { ApplicationStatus } from '../types';

const optionClass = 'text-ink-invert bg-surface';

/**
 * The <option>s of a status picker: the current status, the statuses it may
 * move to, and undoing the last step when there is one.
 */
export function StatusOptions({ status, canUndo }: { status: ApplicationStatus; canUndo: boolean }) {
  return (
    <>
      <option value={status} className={optionClass}>{STATUS_LABELS[status]}</option>
      {allowedNext(status).map((next) => (
        <option key={next} value={next} className={optionClass}>→ {STATUS_LABELS[next]}</option>
      ))}
      {canUndo && <option value="undo" className={optionClass}>↶ undo last step</option>}
    </>
  );
}
