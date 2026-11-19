import { useState } from 'react';
import { STATUS_COLORS, STATUS_LABELS } from '../utils/status';
import { GHOSTED_AFTER_DAYS, ghostedOn } from '#shared/domain/statusMachine.ts';
import { formatDateNumeric, formatDateTime, todayIso, toIsoDate } from '#shared/utils/date.ts';
import { linkify } from '../utils/linkify';
import type { ApplicationConfig, ApplicationStatus, AppLanguage, StatusTransition } from '#shared/types.ts';

interface Props {
  app: ApplicationConfig;
  history: StatusTransition[];
  status: ApplicationStatus;
  language: AppLanguage;
  onDeleteNote: (id: string) => void;
  /** Changes when step `index` of the status history happened. */
  onChangeDate: (index: number, date: string) => void;
}

interface TimelineEvent {
  key: string;
  /**
   * Sorts the timeline: "YYYY-MM-DD" for status steps, "YYYY-MM-DDTHH:MM:SS"
   * (local time) for notes, so on the same day the status step comes first.
   * '' when unknown — such events go to the top.
   */
  sortKey: string;
  dateLabel: string;
  label: string;
  color: string;
  text?: string;
  noteId?: string;
  /** The status step this event shows, whose date can be changed. */
  stepIndex?: number;
  stepDate?: string | null;
}

function noteSortKey(createdAt: string | undefined): string {
  if (!createdAt) return '';
  const date = new Date(createdAt);
  if (Number.isNaN(date.getTime())) return '';
  return `${toIsoDate(date)}T${date.toTimeString().slice(0, 8)}`;
}

const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/**
 * The application's history in chronological order: its notes together with
 * every recorded status step after the first draft and, for a ghosted
 * application, the day it went without a response for too long. The earliest
 * note is labelled as the initial one.
 */
function buildTimeline(app: ApplicationConfig, history: StatusTransition[], status: ApplicationStatus, language: AppLanguage): TimelineEvent[] {
  // A step without a known date (from data before the history existed) sorts
  // with the step before it, so the steps keep their order.
  let previousKey = '';
  const steps = history.map((step, index) => {
    previousKey = step.date ?? previousKey;
    return {
      key: `step-${index}`,
      sortKey: previousKey,
      dateLabel: step.date ? formatDateNumeric(step.date, language) : 'date unknown',
      label: capitalize(STATUS_LABELS[step.to]),
      color: STATUS_COLORS[step.to],
      stepIndex: index,
      stepDate: step.date,
    };
  }).slice(1);

  const events: TimelineEvent[] = [
    ...steps,
    ...(app.notes ?? []).map((note) => ({
      key: note.id,
      sortKey: noteSortKey(note.createdAt),
      dateLabel: note.createdAt ? formatDateTime(note.createdAt, language) : 'undated',
      label: 'Note',
      color: 'var(--accent)',
      text: note.text,
      noteId: note.id,
    })),
  ];
  const sentOn = history.at(-1)?.date;
  if (status === 'ghosted' && sentOn) {
    const due = ghostedOn(sentOn);
    events.push({
      key: 'ghosted',
      sortKey: due < todayIso() ? due : todayIso(),
      dateLabel: formatDateNumeric(due, language),
      label: 'Ghosted',
      color: STATUS_COLORS.ghosted,
      text: `No response ${GHOSTED_AFTER_DAYS}+ days after applying.`,
    });
  }
  events.sort((a, b) => a.sortKey.localeCompare(b.sortKey));
  const firstNote = events.find((e) => e.noteId);
  if (firstNote) firstNote.label = 'Initial note';
  return events;
}

const actionClass =
  'font-mono text-[10px] text-ink-3 bg-transparent border-none cursor-pointer opacity-0 group-hover/event:opacity-100 focus:opacity-100 transition-opacity';

/** A step's date with an inline date picker to correct it. */
function StepDate({ event, onChange }: { event: TimelineEvent; onChange: (date: string) => void }) {
  const [editing, setEditing] = useState(false);
  if (editing) {
    return (
      <input
        type="date"
        autoFocus
        defaultValue={event.stepDate ?? ''}
        className="font-mono text-[10px] bg-surface border border-rule rounded px-1 text-ink-invert [color-scheme:dark]"
        onChange={(e) => e.target.value && onChange(e.target.value)}
        onBlur={() => setEditing(false)}
        onKeyDown={(e) => e.key === 'Escape' && setEditing(false)}
        aria-label={`Date of ${event.label}`}
      />
    );
  }
  return (
    <button type="button" className={actionClass} onClick={() => setEditing(true)} aria-label={`Change the date of ${event.label}`}>
      ✎ date
    </button>
  );
}

// The notes panel of the application page: a log of what happened, from the
// first note through every status step to the decision.
export function ApplicationTimeline({ app, history, status, language, onDeleteNote, onChangeDate }: Props) {
  const events = buildTimeline(app, history, status, language);

  if (events.length === 0) {
    return <p className="font-mono text-[12px] text-ink-2 italic m-0">No notes yet.</p>;
  }

  return (
    <ol className="list-none m-0 p-0 flex flex-col">
      {events.map((event, i) => (
        <li key={event.key} className="group/event relative pl-5 pb-4 last:pb-0">
          {i < events.length - 1 && (
            <span aria-hidden className="absolute left-[4px] top-[12px] bottom-[-2px] w-px bg-rule" />
          )}
          <span aria-hidden className="absolute left-0 top-[4px] w-[9px] h-[9px] rounded-full" style={{ background: event.color }} />
          <div className="flex items-baseline justify-between gap-2">
            <div className="flex items-baseline gap-2 min-w-0 flex-wrap">
              <span className="font-mono text-[11px] font-semibold" style={{ color: event.color }}>
                {event.label}
              </span>
              <span className="font-mono text-[10px] text-ink-3">{event.dateLabel}</span>
            </div>
            {event.stepIndex !== undefined && (
              <StepDate event={event} onChange={(date) => onChangeDate(event.stepIndex!, date)} />
            )}
            {event.noteId && (
              <button
                type="button"
                className={`${actionClass} hover:text-status-rejected`}
                onClick={() => onDeleteNote(event.noteId!)}
                aria-label="Delete note"
              >
                ✕
              </button>
            )}
          </div>
          {event.text && (
            <div className="font-mono text-[12.5px] leading-[1.6] text-ink-invert whitespace-pre-wrap [overflow-wrap:anywhere] mt-1">
              {linkify(event.text)}
            </div>
          )}
        </li>
      ))}
    </ol>
  );
}
