import { expect, test } from 'vitest';
import { MAX_SNIPPET } from '../../server/jobLeadsValidation.ts';
import { MAX_SNIPPET as WORKER_MAX_SNIPPET, SENDER_DOMAINS } from '../../workers/job-alerts/src/parsers.ts';
import { JOB_ALERT_SOURCES } from './jobAlertSources.ts';

test('the account page lists exactly the sender domains the mail worker reads', () => {
  const shown = JOB_ALERT_SOURCES.flatMap((s) => s.domains).sort();
  const supported = SENDER_DOMAINS.map(([domain]) => domain).sort();
  expect(shown).toEqual(supported);
});

test('the mail worker cuts snippets to the length the app accepts', () => {
  expect(WORKER_MAX_SNIPPET).toBe(MAX_SNIPPET);
});
