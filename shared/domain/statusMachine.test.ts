import { assert, expect, test } from 'vitest';
import type { StatusTransition, StoredStatus } from '#shared/types.ts';
import {
  allowedNext,
  appendTransition,
  currentStatus,
  derivedDates,
  seedHistory,
  setTransitionDate,
  TRANSITIONS,
  undoLast,
  validateHistory,
} from '#shared/domain/statusMachine.ts';

const NOW = '2026-11-16T10:00:00.000Z';
const entry = (to: StoredStatus, date: string | null = null): StatusTransition => ({ to, date, recordedAt: null });
const path = (...steps: [StoredStatus, string | null][]) => steps.map(([to, date]) => entry(to, date));

function walk(...steps: StoredStatus[]): StatusTransition[] {
  let history = [entry('drafting')];
  for (const to of steps) {
    const result = appendTransition(history, to, '2026-11-01', NOW);
    assert(result.ok, `expected ${to} to be allowed after ${history.at(-1)!.to}`);
    history = result.history;
  }
  return history;
}

test('the transition table matches the design', () => {
  expect(TRANSITIONS).toEqual({
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
  });
});

test('a checked job starts as evaluated and is either drafted or skipped', () => {
  const start = [entry('evaluated')];
  expect(validateHistory(start).ok).toBeTruthy();
  expect(appendTransition(start, 'drafting', '2026-11-16', NOW).ok).toBeTruthy();
  const skipped = appendTransition(start, 'skipped', '2026-11-16', NOW);
  assert(skipped.ok);
  expect(appendTransition(skipped.history, 'drafting', '2026-11-16', NOW).ok).toBe(false);
  expect(undoLast(start).ok).toBe(false);
  expect(appendTransition([entry('drafting')], 'evaluated', '2026-11-16', NOW).ok).toBe(false);
  expect(seedHistory('evaluated', {})).toEqual(path(['evaluated', null]));
  expect(seedHistory('skipped', {})).toEqual(path(['evaluated', null], ['skipped', null]));
  expect(validateHistory([entry('evaluated'), entry('sent')]).ok).toBe(false);
});

test('every edge of the table can be walked', () => {
  for (const [from, targets] of Object.entries(TRANSITIONS) as [StoredStatus, StoredStatus[]][]) {
    for (const to of targets) {
      const history = from === 'drafting' || from === 'evaluated' ? [entry(from)] : [entry('drafting'), entry(from)];
      expect(appendTransition(history, to, '2026-11-01', NOW).ok, `${from} -> ${to}`).toBeTruthy();
    }
  }
});

test('disallowed jumps are refused with a message naming the allowed ones', () => {
  for (const [steps, to] of [
    [['sent', 'rejected'], 'drafting'],
    [['sent', 'interview', 'offer'], 'rejected'],
    [['sent'], 'ready'],
  ] as [StoredStatus[], StoredStatus][]) {
    const result = appendTransition(walk(...steps), to, '2026-11-01', NOW);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(new RegExp(`"${steps.at(-1)}"`));
  }
});

test('a transition records its business date and when it was entered', () => {
  const result = appendTransition([entry('drafting')], 'sent', '2026-11-10', NOW);
  assert(result.ok);
  expect(result.history.at(-1)).toEqual({ to: 'sent', date: '2026-11-10', recordedAt: NOW });
});

test('a transition needs a valid date', () => {
  expect(appendTransition([entry('drafting')], 'sent', '10.11.2026', NOW).ok).toBe(false);
  expect(appendTransition([entry('drafting')], 'sent', '2026-13-40', NOW).ok).toBe(false);
});

test('sent turns into ghosted after 30 days without an answer', () => {
  const history = path(['drafting', null], ['sent', '2026-10-17']);
  expect(currentStatus(history, '2026-11-15')).toBe('sent');
  expect(currentStatus(history, '2026-11-16')).toBe('ghosted');
});

test('sent without a known date never counts as ghosted', () => {
  expect(currentStatus(path(['drafting', null], ['sent', null]), '2030-01-01')).toBe('sent');
});

test('ghosted allows the same steps as sent', () => {
  expect(allowedNext('ghosted')).toEqual(TRANSITIONS.sent);
});

test('undo removes the last step, down to the initial draft but not past it', () => {
  let history = walk('ready', 'sent');
  for (const expected of ['ready', 'drafting']) {
    const result = undoLast(history);
    assert(result.ok);
    history = result.history;
    expect(history.at(-1)!.to).toBe(expected);
  }
  const refused = undoLast(history);
  expect(refused.ok).toBe(false);
  expect(history).toEqual([entry('drafting')]);
});

test('the date of a step can be changed, but not of the initial draft', () => {
  const history = walk('sent');
  const changed = setTransitionDate(history, 1, '2026-10-30');
  assert(changed.ok);
  expect(changed.history[1].date).toBe('2026-10-30');
  expect(setTransitionDate(history, 0, '2026-10-30').ok).toBe(false);
  expect(setTransitionDate(history, 5, '2026-10-30').ok).toBe(false);
  expect(setTransitionDate(history, 1, 'yesterday').ok).toBe(false);
});

test('seeding builds the shortest plausible path without inventing dates', () => {
  expect(seedHistory('drafting', {})).toEqual(path(['drafting', null]));
  expect(seedHistory('ready', {})).toEqual(path(['drafting', null], ['ready', null]));
  expect(seedHistory('sent', { appliedDate: '10.11.2026' })).toEqual(path(['drafting', null], ['sent', '2026-11-10']));
  expect(seedHistory('interview', { appliedDate: '11/10/2026' })).toEqual(
    path(['drafting', null], ['sent', '2026-11-10'], ['interview', null]),
  );
  expect(
    seedHistory('rejected', {
      appliedDate: '2026-10-01',
      interviewDate: '2026-10-08',
      finalDecisionDate: '2026-10-20',
    }),
  ).toEqual(path(['drafting', null], ['sent', '2026-10-01'], ['interview', '2026-10-08'], ['rejected', '2026-10-20']));
  expect(seedHistory('rejected', {})).toEqual(path(['drafting', null], ['sent', null], ['rejected', null]));
  expect(seedHistory('withdrawn', {})).toEqual(path(['drafting', null], ['withdrawn', null]));
  expect(seedHistory('withdrawn', { appliedDate: '2026-10-01' })).toEqual(
    path(['drafting', null], ['sent', '2026-10-01'], ['withdrawn', null]),
  );
  expect(seedHistory('accepted', { finalDecisionDate: '2026-11-01' })).toEqual(
    path(['drafting', null], ['sent', null], ['offer', null], ['accepted', '2026-11-01']),
  );
});

test('a stored ghosted status seeds as sent', () => {
  expect(seedHistory('ghosted', {})).toEqual(path(['drafting', null], ['sent', null]));
  expect(currentStatus(seedHistory('ghosted', {}), '2030-01-01')).toBe('sent');
  expect(currentStatus(seedHistory('ghosted', { appliedDate: '2026-01-01' }), '2026-11-16')).toBe('ghosted');
});

test('every seeded history is valid', () => {
  for (const status of [
    'drafting',
    'ready',
    'sent',
    'interview',
    'offer',
    'rejected',
    'ghosted',
    'withdrawn',
    'accepted',
    'declined',
    'evaluated',
    'skipped',
  ] as const) {
    expect(validateHistory(seedHistory(status, { appliedDate: '2026-10-01' })).ok, status).toBeTruthy();
  }
});

test('dates are derived from the history', () => {
  const history = path(
    ['drafting', null],
    ['sent', '2026-10-01'],
    ['interview', '2026-10-08'],
    ['offer', '2026-10-20'],
    ['accepted', '2026-10-25'],
  );
  expect(derivedDates(history, 'de')).toEqual({
    appliedDate: '01.10.2026',
    interviewDate: '08.10.2026',
    finalDecisionDate: '25.10.2026',
  });
  expect(derivedDates(path(['drafting', null]), 'en')).toEqual({});
  expect(derivedDates(path(['drafting', null], ['sent', null]), 'en')).toEqual({});
});

test('validation rejects malformed or impossible histories', () => {
  expect(validateHistory('nope').ok).toBe(false);
  expect(validateHistory([]).ok).toBe(false);
  expect(validateHistory([entry('sent')]).ok).toBe(false);
  expect(validateHistory([entry('drafting'), entry('accepted')]).ok).toBe(false);
  expect(validateHistory([entry('drafting'), { to: 'sent', date: 'x', recordedAt: null }]).ok).toBe(false);
  expect(validateHistory([entry('drafting'), { to: 'ghosted', date: null, recordedAt: null }]).ok).toBe(false);
  expect(validateHistory([entry('drafting'), entry('sent', '2026-11-01')]).ok).toBeTruthy();
});
