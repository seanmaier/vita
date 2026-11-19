import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { STATUS_LABELS, STATUS_COLORS } from '../../utils/status';
import { StatusOptions } from '../StatusOptions';
import { FitBadge } from './FitBadge';
import type { StatusAction } from '../../utils/statusTransitions';
import { NotesDialog } from '../NotesDialog';
import { LANGUAGE_LABELS } from '../../utils/language';
import { summarizeNotes } from '../../utils/notes';
import type { AppLanguage, ApplicationConfig, ApplicationStatus, Note } from '../../types';

const dateCellClass =
  '[font-family:var(--font-mono)] text-[11px] text-[color:var(--ink-3)] w-[88px] shrink-0 text-right truncate ml-2';

const langBadgeClass =
  '[font-family:var(--font-mono)] uppercase tracking-[0.06em] leading-none shrink-0 text-[color:var(--ink-2)] border border-[color:var(--rule)] rounded px-1 py-[3px]';

// Card layout (below lg): dates sit in a labelled 3-column grid instead of
// fixed-width table cells. They follow the status history; to change one,
// edit its step on the application's timeline.
const cardLabelClass = '[font-family:var(--font-mono)] text-[9px] uppercase tracking-[0.1em] text-[color:var(--ink-3)]';
const cardDateClass = '[font-family:var(--font-mono)] text-[12px] text-[color:var(--ink-2)] block truncate py-1';

interface Props {
  application: ApplicationConfig;
  /** The effective language, including edits saved on top of the application. */
  language: AppLanguage;
  status: ApplicationStatus;
  /** Whether the status history has a step to undo. */
  canUndo: boolean;
  appliedDate?: string;
  interviewDate?: string;
  finalDecisionDate?: string;
  notes?: Note[];
  onStatusChange: (action: StatusAction) => void;
  onNotesAdd: (text: string) => void;
  onNotesDelete: (id: string) => void;
  onDelete?: () => void;
}

export function ApplicationCard({
  application,
  language,
  status,
  canUndo,
  appliedDate,
  interviewDate,
  finalDecisionDate,
  notes,
  onStatusChange,
  onNotesAdd,
  onNotesDelete,
  onDelete,
}: Props) {
  const navigate = useNavigate();
  const [editingStatus, setEditingStatus] = useState(false);
  const [notesOpen, setNotesOpen] = useState(false);

  const handleStatusClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    setEditingStatus(true);
  };

  const handleStatusChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    e.stopPropagation();
    onStatusChange(e.target.value as StatusAction);
    setEditingStatus(false);
  };

  const handleStatusBlur = () => setEditingStatus(false);

  const open = () => navigate(`/application/${application.id}`);
  const dateFields: { field: string; label: string; value?: string }[] = [
    { field: 'appliedDate', label: 'applied', value: appliedDate },
    { field: 'interviewDate', label: 'interview', value: interviewDate },
    { field: 'finalDecisionDate', label: 'decision', value: finalDecisionDate },
  ];

  return (
    <>
      {/* ── Card (below lg) ── */}
      <div
        className="lg:hidden flex flex-col gap-3 border border-[color:var(--rule)] rounded-md p-3.5 cursor-pointer transition-colors duration-100 active:bg-[color:var(--surface)]"
        onClick={open}
      >
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-1.5">
              <span className="[font-family:var(--font-mono)] text-[13.5px] text-[color:var(--ink-invert)] truncate">
                {application.company}
              </span>
              <span className={`${langBadgeClass} text-[10px]`} title={LANGUAGE_LABELS[language]}>
                {language}
              </span>
              {application.fit && <FitBadge fit={application.fit} className="text-[11px] shrink-0" />}
            </div>
            <div className="[font-family:var(--font-mono)] text-[12px] text-[color:var(--ink-2)] mt-1 line-clamp-2">
              {application.role}
            </div>
          </div>
          <div className="flex items-center gap-1.5 shrink-0">
            {application.url && (
              <a
                href={application.url}
                target="_blank"
                rel="noopener noreferrer"
                className="[font-family:var(--font-mono)] text-[13px] text-[color:var(--ink-3)] no-underline border border-[color:var(--rule)] rounded w-8 h-8 flex items-center justify-center"
                onClick={(e) => e.stopPropagation()}
                title={application.url}
                aria-label="Open job posting"
              >
                ↗
              </a>
            )}
            {onDelete && (
              <button
                className="[font-family:var(--font-mono)] text-[12px] text-[color:var(--ink-2)] bg-transparent border border-[color:var(--rule)] rounded w-8 h-8 cursor-pointer leading-none"
                onClick={(e) => {
                  e.stopPropagation();
                  onDelete();
                }}
                title="Move to trash"
                aria-label="Move application to trash"
              >
                ✕
              </button>
            )}
          </div>
        </div>

        {/* Always a select here: there's no hover on touch, and a native picker is easier to hit than a tap-to-edit label */}
        <select
          data-tour="status"
          className="self-start [font-family:var(--font-mono)] text-[12px] bg-[color:var(--surface)] border border-[color:var(--rule)] rounded px-2 py-1.5 cursor-pointer"
          value={status}
          style={{ color: STATUS_COLORS[status] }}
          onChange={(e) => onStatusChange(e.target.value as StatusAction)}
          onClick={(e) => e.stopPropagation()}
          aria-label="Status"
        >
          <StatusOptions status={status} canUndo={canUndo} />
        </select>

        <div className="grid grid-cols-3 gap-2">
          {dateFields.map(({ field, label, value }) => (
            <div key={field} className="min-w-0">
              <div className={cardLabelClass}>{label}</div>
              <span className={cardDateClass}>{value || '—'}</span>
            </div>
          ))}
        </div>

        <div
          className="border-t border-[color:var(--rule)] pt-2.5"
          onClick={(e) => {
            e.stopPropagation();
            setNotesOpen(true);
          }}
        >
          <div className={cardLabelClass}>notes</div>
          <p
            className={`[font-family:var(--font-mono)] text-[12px] text-[color:var(--ink-2)] mt-1 line-clamp-2 whitespace-pre-line ${notes?.length ? '' : 'opacity-40'}`}
          >
            {notes?.length ? summarizeNotes(notes) : 'tap to add notes'}
          </p>
        </div>
      </div>

      {/* ── Table row (lg and up) ── */}
      <div
        className="group hidden lg:flex items-center border-b border-[color:var(--rule)] py-2.5 cursor-pointer transition-colors duration-100 hover:bg-[color:var(--surface)]"
        onClick={open}
      >
        {/* Company */}
        <div className="w-[190px] shrink-0 min-w-0 [font-family:var(--font-mono)] text-[12.5px] text-[color:var(--ink-invert)] truncate">
          {application.company}
        </div>

        {/* Role */}
        <div className="flex-1 [font-family:var(--font-mono)] text-[12px] text-[color:var(--ink-2)] truncate min-w-[120px]">
          {application.role}
        </div>

        {/* URL icon */}
        <div className="w-[28px] shrink-0 flex items-center justify-center">
          {application.url && (
            <a
              href={application.url}
              target="_blank"
              rel="noopener noreferrer"
              className="[font-family:var(--font-mono)] text-[12px] text-[color:var(--ink-3)] no-underline hover:text-[color:var(--accent)] transition-colors duration-100"
              onClick={(e) => e.stopPropagation()}
              title={application.url}
            >
              ↗
            </a>
          )}
        </div>

        {/* Language */}
        <div className="w-[44px] shrink-0 flex items-center justify-center">
          <span className={`${langBadgeClass} text-[9.5px]`} title={LANGUAGE_LABELS[language]}>
            {language}
          </span>
        </div>

        {/* Fit from the job check */}
        <div className="w-[48px] shrink-0 flex items-center justify-end">
          <FitBadge fit={application.fit} className="text-[11px]" />
        </div>

        {/* Status — inline select on click */}
        <div data-tour="status" className="w-[116px] shrink-0 flex items-center justify-end pr-1">
          {editingStatus ? (
            <select
              autoFocus
              className="[font-family:var(--font-mono)] text-[11px] bg-[color:var(--surface)] border border-[color:var(--rule)] rounded px-1.5 py-0.5 cursor-pointer w-full"
              value={status}
              style={{ color: STATUS_COLORS[status] }}
              onChange={handleStatusChange}
              onBlur={handleStatusBlur}
              onClick={(e) => e.stopPropagation()}
            >
              <StatusOptions status={status} canUndo={canUndo} />
            </select>
          ) : (
            <span
              className="[font-family:var(--font-mono)] text-[11px] cursor-pointer hover:opacity-70 transition-opacity"
              style={{ color: STATUS_COLORS[status] }}
              onClick={handleStatusClick}
              title="Click to change status"
            >
              [{STATUS_LABELS[status]}]
            </span>
          )}
        </div>

        {/* Dates, from the status history */}
        {dateFields.map(({ field, label, value }) => (
          <span key={field} className={dateCellClass} title={`${label} date — change it on the application's timeline`}>
            {value || '—'}
          </span>
        ))}

        {/* Notes — the cell only previews; adding/viewing happens in a dialog */}
        <span
          className={`[font-family:var(--font-mono)] text-[11px] text-[color:var(--ink-2)] w-[170px] shrink-0 pl-3 truncate cursor-pointer hover:opacity-70 transition-opacity ${notes?.length ? '' : 'opacity-40'}`}
          onClick={(e) => {
            e.stopPropagation();
            setNotesOpen(true);
          }}
          title={notes?.length ? 'Click to view notes' : 'Click to add notes'}
        >
          {notes?.length ? summarizeNotes(notes) : '—'}
        </span>

        {/* Delete (local apps only) — pinned to the right edge so it stays in
          view even when the row is wider than the window and scrolls. */}
        <div className="sticky right-0 w-[36px] shrink-0 self-stretch flex items-center justify-center bg-[color:var(--bg)] group-hover:bg-[color:var(--surface)] transition-colors duration-100">
          {onDelete && (
            <button
              className="[font-family:var(--font-mono)] text-[11px] text-[color:var(--ink-2)] bg-transparent border border-[color:var(--rule)] rounded w-[24px] h-[22px] cursor-pointer leading-none hover:text-[color:var(--status-rejected)] hover:border-[color:var(--status-rejected)] transition-colors"
              onClick={(e) => {
                e.stopPropagation();
                onDelete();
              }}
              title="Move to trash"
            >
              ✕
            </button>
          )}
        </div>
      </div>

      {notesOpen && (
        <NotesDialog
          company={application.company}
          notes={notes ?? []}
          language={language}
          onAdd={onNotesAdd}
          onDelete={onNotesDelete}
          onClose={() => setNotesOpen(false)}
        />
      )}
    </>
  );
}
