import assert from 'node:assert/strict';
import { test } from 'node:test';
import { validateApplicationConfig } from './parseApplicationConfig.ts';

const base = { company: 'Acme', role: 'Dev' };
const fit = {
  score: 72,
  recommendation: 'apply-if',
  reason: 'Fits if hybrid in Hamburg.',
  evaluatedAt: '2026-11-16T10:00:00.000Z',
};

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
    if (!result.ok)
      assert.ok(
        result.errors.some((e) => e.startsWith('"fit')),
        JSON.stringify(result.errors),
      );
  }
});

test('an application without a fit has none', () => {
  const result = validateApplicationConfig(base);
  assert.ok(result.ok);
  assert.equal(result.config.fit, undefined);
});

const criteria = [
  { name: 'Stack-Passung', weight: 60, fulfilled: 50 },
  { name: 'Standort & Pendeln', weight: 40, fulfilled: 75 },
];

test('a fit keeps its criteria breakdown and exclusion', () => {
  const given = { ...fit, score: 60, cappedScore: 20, criteria, exclusion: 'Freelance' };
  const result = validateApplicationConfig({ ...base, fit: given });
  assert.ok(result.ok);
  assert.deepEqual(result.config.fit, given);
});

test('a fit score must match its breakdown within one point', () => {
  assert.ok(validateApplicationConfig({ ...base, fit: { ...fit, score: 61, criteria } }).ok);
  const result = validateApplicationConfig({ ...base, fit: { ...fit, score: 62, criteria } });
  assert.ok(!result.ok);
  assert.ok(result.errors.some((e) => e.includes('"fit.score"')));
});

test('a fit with a broken breakdown or an exclusion without one is rejected', () => {
  const broken = validateApplicationConfig({
    ...base,
    fit: { ...fit, score: 60, criteria: [{ ...criteria[0], weight: 50 }, criteria[1]] },
  });
  assert.ok(!broken.ok);
  assert.ok(broken.errors.some((e) => e.includes('"fit.criteria"')));
  const lonely = validateApplicationConfig({ ...base, fit: { ...fit, exclusion: 'Freelance' } });
  assert.ok(!lonely.ok);
  assert.ok(lonely.errors.some((e) => e.includes('"fit.exclusion"')));
});

test('a fit without a breakdown gets no criteria or exclusion keys', () => {
  const result = validateApplicationConfig({ ...base, fit });
  assert.ok(result.ok);
  assert.ok(!('criteria' in result.config.fit!));
  assert.ok(!('exclusion' in result.config.fit!));
});
