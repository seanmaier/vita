// The rules for how an application's status may change, shared by the server
// (which enforces them), the app and the demo. Pure functions over a status
// history: the list of recorded transitions, oldest first, always starting
// with "drafting" (or "evaluated" for a checked job). The current status is the last step, except that a "sent"
// application without an answer for GHOSTED_AFTER_DAYS shows as "ghosted";
// that is derived, never stored, so a late answer is an ordinary next step.
import type { AppLanguage, ApplicationConfig, ApplicationStatus, StatusTransition, StoredStatus } from '../types.ts';
import { formatDateNumeric, numericDateToIso, toIsoDate } from '../utils/date.ts';

/** A sent application without any response for this many days counts as ghosted. */
export const GHOSTED_AFTER_DAYS = 30;

/** Where each status may go next. Terminal statuses are left only by undoing the last step. */
export const TRANSITIONS: Record<StoredStatus, StoredStatus[]> = {
  drafting: ['ready', 'sent', 'withdrawn'],
  ready: ['drafting', 'sent', 'withdrawn'],
  sent: ['interview', 'offer', 'rejected', 'withdrawn'],
  interview: ['offer', 'rejected', 'withdrawn'],
  offer: ['accepted', 'declined'],
  rejected: [],
  withdrawn: [],
  accepted: [],
  declined: [],
  evaluated: ['drafting', 'skipped'],
  skipped: [],
};

/** Where a status history may start: a new draft, or a checked job. */
export const INITIAL_STATUSES: StoredStatus[] = ['drafting', 'evaluated'];

export const STORED_STATUSES = Object.keys(TRANSITIONS) as StoredStatus[];

/** Statuses that settle an application; the last of them dates the decision. */
const DECISION_STATUSES: StoredStatus[] = ['offer', 'rejected', 'withdrawn', 'accepted', 'declined'];

export type HistoryResult = { ok: true; history: StatusTransition[] } | { ok: false; error: string };

const fail = (error: string): HistoryResult => ({ ok: false, error });

export function isStoredStatus(value: unknown): value is StoredStatus {
  return typeof value === 'string' && value in TRANSITIONS;
}

/** A real calendar date written as "YYYY-MM-DD". */
export function isIsoDate(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00`);
  return !Number.isNaN(date.getTime()) && toIsoDate(date) === value;
}

function storedOf(status: ApplicationStatus): StoredStatus {
  return status === 'ghosted' ? 'sent' : status;
}

export function allowedNext(status: ApplicationStatus): StoredStatus[] {
  return TRANSITIONS[storedOf(status)];
}

export function canTransition(from: ApplicationStatus, to: StoredStatus): boolean {
  return allowedNext(from).includes(to);
}

/** The ISO date a "sent" step dated `sentOn` turns into ghosted. */
export function ghostedOn(sentOn: string): string {
  const date = new Date(`${sentOn}T00:00:00`);
  date.setDate(date.getDate() + GHOSTED_AFTER_DAYS);
  return toIsoDate(date);
}

/** The status to show: the last step, or "ghosted" for a sent application left unanswered too long. */
export function currentStatus(history: StatusTransition[], today: string): ApplicationStatus {
  const last = history.at(-1);
  if (!last) return 'drafting';
  if (last.to === 'sent' && last.date && ghostedOn(last.date) <= today) return 'ghosted';
  return last.to;
}

function disallowed(from: ApplicationStatus, to: StoredStatus): string {
  const allowed = allowedNext(from);
  const options = allowed.length ? allowed.map((s) => `"${s}"`).join(', ') : 'nothing (undo the last step instead)';
  return `Can't go from "${from}" to "${to}". From "${from}" it can go to ${options}.`;
}

export function appendTransition(history: StatusTransition[], to: StoredStatus, date: string, now: string): HistoryResult {
  if (!isIsoDate(date)) return fail(`"date" must be a date like "2026-11-16".`);
  const from = history.at(-1)?.to ?? 'drafting';
  if (!canTransition(from, to)) return fail(disallowed(from, to));
  return { ok: true, history: [...history, { to, date, recordedAt: now }] };
}

export function undoLast(history: StatusTransition[]): HistoryResult {
  if (history.length <= 1) return fail('There is nothing to undo: the application is at its first step.');
  return { ok: true, history: history.slice(0, -1) };
}

export function setTransitionDate(history: StatusTransition[], index: number, date: string): HistoryResult {
  if (!isIsoDate(date)) return fail(`"date" must be a date like "2026-11-16".`);
  if (!Number.isInteger(index) || index < 1 || index >= history.length) {
    return fail(`No step ${index} to change; steps 1 to ${history.length - 1} have a date.`);
  }
  return { ok: true, history: history.map((t, i) => (i === index ? { ...t, date } : t)) };
}

type LegacyDates = Pick<ApplicationConfig, 'appliedDate' | 'interviewDate' | 'finalDecisionDate'>;

function isoOrNull(value: string | undefined): string | null {
  if (!value) return null;
  const iso = numericDateToIso(value);
  return isIsoDate(iso) ? iso : null;
}

/**
 * A history for an application that only has a status and the old date
 * fields: the shortest path to that status the transitions allow, dated from
 * those fields where they apply. Unknown dates stay null.
 */
export function seedHistory(status: ApplicationStatus, dates: LegacyDates): StatusTransition[] {
  const applied = isoOrNull(dates.appliedDate);
  const interview = isoOrNull(dates.interviewDate);
  const decision = isoOrNull(dates.finalDecisionDate);
  const step = (to: StoredStatus, date: string | null = null): StatusTransition => ({ to, date, recordedAt: null });
  const target = storedOf(status);

  if (target === 'evaluated') return [step('evaluated')];
  if (target === 'skipped') return [step('evaluated'), step('skipped', decision)];
  const steps = [step('drafting')];
  if (target === 'drafting') return steps;
  if (target === 'ready') return [...steps, step('ready')];
  if (target === 'withdrawn' && !applied && !interview) return [...steps, step('withdrawn', decision)];

  steps.push(step('sent', applied));
  if (target === 'sent') return steps;
  if (target === 'interview' || interview) steps.push(step('interview', interview));
  if (target === 'interview') return steps;
  if (target === 'accepted' || target === 'declined') steps.push(step('offer'));
  steps.push(step(target, decision));
  return steps;
}

/** Checks a history from outside (an import): its shape, that it starts as a draft, and that every step is allowed. */
export function validateHistory(value: unknown): HistoryResult {
  if (!Array.isArray(value) || value.length === 0) return fail('A status history must be a non-empty list.');
  const history: StatusTransition[] = [];
  for (const [i, raw] of value.entries()) {
    const t = raw as Partial<StatusTransition> | null;
    if (typeof t !== 'object' || t === null || !isStoredStatus(t.to)) return fail(`Step ${i} has no valid "to" status.`);
    if (t.date !== null && !isIsoDate(t.date)) return fail(`Step ${i} has an invalid "date".`);
    if (t.recordedAt !== null && typeof t.recordedAt !== 'string') return fail(`Step ${i} has an invalid "recordedAt".`);
    if (i === 0 && !INITIAL_STATUSES.includes(t.to)) return fail('A status history must start with "drafting" or "evaluated".');
    if (i > 0 && !canTransition(history[i - 1].to, t.to)) return fail(`Step ${i}: ${disallowed(history[i - 1].to, t.to)}`);
    history.push({ to: t.to, date: t.date ?? null, recordedAt: t.recordedAt ?? null });
  }
  return { ok: true, history };
}

/** The applied, interview and decision dates shown for an application, formatted like the old date fields. */
export function derivedDates(history: StatusTransition[], language: AppLanguage): LegacyDates {
  const format = (t: StatusTransition | undefined) => (t?.date ? formatDateNumeric(t.date, language) : undefined);
  const applied = format(history.findLast((t) => t.to === 'sent'));
  const interview = format(history.find((t) => t.to === 'interview'));
  const decision = format(history.findLast((t) => DECISION_STATUSES.includes(t.to)));
  return {
    ...(applied && { appliedDate: applied }),
    ...(interview && { interviewDate: interview }),
    ...(decision && { finalDecisionDate: decision }),
  };
}
