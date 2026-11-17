import assert from 'node:assert/strict';
import { test } from 'node:test';
import { SENDER_DOMAINS } from '../../workers/job-alerts/src/parsers.ts';
import { JOB_ALERT_SOURCES } from './jobAlertSources.ts';

test('the account page lists exactly the sender domains the mail worker reads', () => {
  const shown = JOB_ALERT_SOURCES.flatMap((s) => s.domains).sort();
  const supported = SENDER_DOMAINS.map(([domain]) => domain).sort();
  assert.deepEqual(shown, supported);
});
