import { Link } from 'react-router-dom';
import { isDemo } from '../../demo/demoMode';
import {
  editAppCompany,
  editAppHeader,
  editAppHeaderActions,
  editHistoryBtn,
  editMessageInput,
  editResetBtn,
  editSaveBtn,
  newAppBack,
  newAppTitle,
} from '../../styles/formStyles';

interface Props {
  appId: string;
  company: string;
  /** Whether saved edits exist that "Reset to default" would drop. */
  hasSavedEdits: boolean;
  changeMessage: string;
  onChangeMessage: (message: string) => void;
  onSave: () => void;
  onReset: () => void;
  onOpenHistory: () => void;
}

/** The edit page's top bar: back link, title, and history, reset and save. */
export function EditHeader({
  appId,
  company,
  hasSavedEdits,
  changeMessage,
  onChangeMessage,
  onSave,
  onReset,
  onOpenHistory,
}: Props) {
  return (
    <div className={editAppHeader}>
      <Link className={newAppBack} to={`/application/${appId}`}>
        ← {company}
      </Link>
      <span className={newAppTitle}>
        Editing &nbsp;<span className={editAppCompany}>{company}</span>
      </span>
      <div className={editAppHeaderActions}>
        {!isDemo && (
          // On desktop the change bar under the form takes over history and message.
          <button className={`${editHistoryBtn} lg:hidden`} onClick={onOpenHistory}>
            History
          </button>
        )}
        {hasSavedEdits && (
          <button className={editResetBtn} onClick={onReset}>
            Reset to default
          </button>
        )}
        {!isDemo && (
          <input
            className={`${editMessageInput} lg:hidden`}
            placeholder="What changed? (optional)"
            aria-label="Describe what this save changes (optional)"
            maxLength={500}
            value={changeMessage}
            onChange={(e) => onChangeMessage(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') onSave();
            }}
          />
        )}
        <button className={editSaveBtn} onClick={onSave}>
          Save changes
        </button>
      </div>
    </div>
  );
}
