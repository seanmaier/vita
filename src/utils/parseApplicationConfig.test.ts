import assert from 'node:assert/strict';
import { test } from 'node:test';
import { validateApplicationConfig } from './parseApplicationConfig.ts';

const base = { company: 'Acme', role: 'Dev' };
const fit = { score: 72, recommendation: 'apply-if', reason: 'Fits if hybrid in Hamburg.', evaluatedAt: '2026-11-16T10:00:00.000Z' };

test('a fit is kept as given', () => {
  const result = validateApplicationConfig({ ...base, fit: { ...fit, cappedScore: 40 } });
  assert.ok(result.ok);
  assert.deepEqual(result.config.fit, { ...fit, cappedScore: 40 });
});

test('a fit needs a score from 0 to 100, a known recommendation, a reason and a time', () => {
  for (const bad of [
    { ...fit, score: 101 },
    { ...fit, score: '72' },
    { ...fit, cappedScore: -1 },
    { ...fit, recommendation: 'maybe' },
    { ...fit, reason: '' },
    { ...fit, evaluatedAt: 'yesterday' },
    'high',
  ]) {
    const result = validateApplicationConfig({ ...base, fit: bad });
    assert.equal(result.ok, false, JSON.stringify(bad));
    if (!result.ok) assert.ok(result.errors.some((e) => e.startsWith('"fit')), JSON.stringify(result.errors));
  }
});

test('an application without a fit has none', () => {
  const result = validateApplicationConfig(base);
  assert.ok(result.ok);
  assert.equal(result.config.fit, undefined);
});
