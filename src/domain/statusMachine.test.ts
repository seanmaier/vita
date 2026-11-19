import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { StatusTransition, StoredStatus } from '../types.ts';
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
} from './statusMachine.ts';

const NOW = '2026-11-16T10:00:00.000Z';
const entry = (to: StoredStatus, date: string | null = null): StatusTransition => ({ to, date, recordedAt: null });
const path = (...steps: [StoredStatus, string | null][]) => steps.map(([to, date]) => entry(to, date));

function walk(...steps: StoredStatus[]): StatusTransition[] {
  let history = [entry('drafting')];
  for (const to of steps) {
    const result = appendTransition(history, to, '2026-11-01', NOW);
    assert.ok(result.ok, `expected ${to} to be allowed after ${history.at(-1)!.to}`);
    history = result.history;
  }
  return history;
}

test('the transition table matches the design', () => {
  assert.deepEqual(TRANSITIONS, {
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
  assert.ok(validateHistory(start).ok);
  assert.ok(appendTransition(start, 'drafting', '2026-11-16', NOW).ok);
  const skipped = appendTransition(start, 'skipped', '2026-11-16', NOW);
  assert.ok(skipped.ok);
  assert.equal(appendTransition(skipped.history, 'drafting', '2026-11-16', NOW).ok, false);
  assert.equal(undoLast(start).ok, false);
  assert.equal(appendTransition([entry('drafting')], 'evaluated', '2026-11-16', NOW).ok, false);
  assert.deepEqual(seedHistory('evaluated', {}), path(['evaluated', null]));
  assert.deepEqual(seedHistory('skipped', {}), path(['evaluated', null], ['skipped', null]));
  assert.equal(validateHistory([entry('evaluated'), entry('sent')]).ok, false);
});

test('every edge of the table can be walked', () => {
  for (const [from, targets] of Object.entries(TRANSITIONS) as [StoredStatus, StoredStatus[]][]) {
    for (const to of targets) {
      const history = from === 'drafting' || from === 'evaluated' ? [entry(from)] : [entry('drafting'), entry(from)];
      assert.ok(appendTransition(history, to, '2026-11-01', NOW).ok, `${from} -> ${to}`);
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
    assert.equal(result.ok, false);
    if (!result.ok) assert.match(result.error, new RegExp(`"${steps.at(-1)}"`));
  }
});

test('a transition records its business date and when it was entered', () => {
  const result = appendTransition([entry('drafting')], 'sent', '2026-11-10', NOW);
  assert.ok(result.ok);
  assert.deepEqual(result.history.at(-1), { to: 'sent', date: '2026-11-10', recordedAt: NOW });
});

test('a transition needs a valid date', () => {
  assert.equal(appendTransition([entry('drafting')], 'sent', '10.11.2026', NOW).ok, false);
  assert.equal(appendTransition([entry('drafting')], 'sent', '2026-13-40', NOW).ok, false);
});

test('sent turns into ghosted after 30 days without an answer', () => {
  const history = path(['drafting', null], ['sent', '2026-10-17']);
  assert.equal(currentStatus(history, '2026-11-15'), 'sent');
  assert.equal(currentStatus(history, '2026-11-16'), 'ghosted');
});

test('sent without a known date never counts as ghosted', () => {
  assert.equal(currentStatus(path(['drafting', null], ['sent', null]), '2030-01-01'), 'sent');
});

test('ghosted allows the same steps as sent', () => {
  assert.deepEqual(allowedNext('ghosted'), TRANSITIONS.sent);
});

test('undo removes the last step, down to the initial draft but not past it', () => {
  let history = walk('ready', 'sent');
  for (const expected of ['ready', 'drafting']) {
    const result = undoLast(history);
    assert.ok(result.ok);
    history = result.history;
    assert.equal(history.at(-1)!.to, expected);
  }
  const refused = undoLast(history);
  assert.equal(refused.ok, false);
  assert.deepEqual(history, [entry('drafting')]);
});

test('the date of a step can be changed, but not of the initial draft', () => {
  const history = walk('sent');
  const changed = setTransitionDate(history, 1, '2026-10-30');
  assert.ok(changed.ok);
  assert.equal(changed.history[1].date, '2026-10-30');
  assert.equal(setTransitionDate(history, 0, '2026-10-30').ok, false);
  assert.equal(setTransitionDate(history, 5, '2026-10-30').ok, false);
  assert.equal(setTransitionDate(history, 1, 'yesterday').ok, false);
});

test('seeding builds the shortest plausible path without inventing dates', () => {
  assert.deepEqual(seedHistory('drafting', {}), path(['drafting', null]));
  assert.deepEqual(seedHistory('ready', {}), path(['drafting', null], ['ready', null]));
  assert.deepEqual(
    seedHistory('sent', { appliedDate: '10.11.2026' }),
    path(['drafting', null], ['sent', '2026-11-10']),
  );
  assert.deepEqual(
    seedHistory('interview', { appliedDate: '11/10/2026' }),
    path(['drafting', null], ['sent', '2026-11-10'], ['interview', null]),
  );
  assert.deepEqual(
    seedHistory('rejected', {
      appliedDate: '2026-10-01',
      interviewDate: '2026-10-08',
      finalDecisionDate: '2026-10-20',
    }),
    path(['drafting', null], ['sent', '2026-10-01'], ['interview', '2026-10-08'], ['rejected', '2026-10-20']),
  );
  assert.deepEqual(seedHistory('rejected', {}), path(['drafting', null], ['sent', null], ['rejected', null]));
  assert.deepEqual(seedHistory('withdrawn', {}), path(['drafting', null], ['withdrawn', null]));
  assert.deepEqual(
    seedHistory('withdrawn', { appliedDate: '2026-10-01' }),
    path(['drafting', null], ['sent', '2026-10-01'], ['withdrawn', null]),
  );
  assert.deepEqual(
    seedHistory('accepted', { finalDecisionDate: '2026-11-01' }),
    path(['drafting', null], ['sent', null], ['offer', null], ['accepted', '2026-11-01']),
  );
});

test('a stored ghosted status seeds as sent', () => {
  assert.deepEqual(seedHistory('ghosted', {}), path(['drafting', null], ['sent', null]));
  assert.equal(currentStatus(seedHistory('ghosted', {}), '2030-01-01'), 'sent');
  assert.equal(currentStatus(seedHistory('ghosted', { appliedDate: '2026-01-01' }), '2026-11-16'), 'ghosted');
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
    assert.ok(validateHistory(seedHistory(status, { appliedDate: '2026-10-01' })).ok, status);
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
  assert.deepEqual(derivedDates(history, 'de'), {
    appliedDate: '01.10.2026',
    interviewDate: '08.10.2026',
    finalDecisionDate: '25.10.2026',
  });
  assert.deepEqual(derivedDates(path(['drafting', null]), 'en'), {});
  assert.deepEqual(derivedDates(path(['drafting', null], ['sent', null]), 'en'), {});
});

test('validation rejects malformed or impossible histories', () => {
  assert.equal(validateHistory('nope').ok, false);
  assert.equal(validateHistory([]).ok, false);
  assert.equal(validateHistory([entry('sent')]).ok, false);
  assert.equal(validateHistory([entry('drafting'), entry('accepted')]).ok, false);
  assert.equal(validateHistory([entry('drafting'), { to: 'sent', date: 'x', recordedAt: null }]).ok, false);
  assert.equal(validateHistory([entry('drafting'), { to: 'ghosted', date: null, recordedAt: null }]).ok, false);
  assert.ok(validateHistory([entry('drafting'), entry('sent', '2026-11-01')]).ok);
});
