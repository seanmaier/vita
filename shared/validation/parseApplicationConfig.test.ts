import { assert, expect, test } from 'vitest';
import { validateApplicationConfig } from '#shared/validation/parseApplicationConfig.ts';

const base = { company: 'Acme', role: 'Dev' };
const fit = {
  score: 72,
  recommendation: 'apply-if',
  reason: 'Fits if hybrid in Hamburg.',
  evaluatedAt: '2026-11-16T10:00:00.000Z',
};

test('a fit is kept as given', () => {
  const result = validateApplicationConfig({ ...base, fit: { ...fit, cappedScore: 40 } });
  assert(result.ok);
  expect(result.config.fit).toEqual({ ...fit, cappedScore: 40 });
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
    expect(result.ok, JSON.stringify(bad)).toBe(false);
    if (!result.ok)
      expect(
        result.errors.some((e) => e.startsWith('"fit')),
        JSON.stringify(result.errors),
      ).toBeTruthy();
  }
});

test('an application without a fit has none', () => {
  const result = validateApplicationConfig(base);
  assert(result.ok);
  expect(result.config.fit).toBe(undefined);
});

const criteria = [
  { name: 'Stack-Passung', weight: 60, fulfilled: 50 },
  { name: 'Standort & Pendeln', weight: 40, fulfilled: 75 },
];

test('a fit keeps its criteria breakdown and exclusion', () => {
  const given = { ...fit, score: 60, cappedScore: 20, criteria, exclusion: 'Freelance' };
  const result = validateApplicationConfig({ ...base, fit: given });
  assert(result.ok);
  expect(result.config.fit).toEqual(given);
});

test('a fit score must match its breakdown within one point', () => {
  expect(validateApplicationConfig({ ...base, fit: { ...fit, score: 61, criteria } }).ok).toBeTruthy();
  const result = validateApplicationConfig({ ...base, fit: { ...fit, score: 62, criteria } });
  assert(!result.ok);
  expect(result.errors).toContainEqual(expect.stringContaining('"fit.score"'));
});

test('a fit with a broken breakdown or an exclusion without one is rejected', () => {
  const broken = validateApplicationConfig({
    ...base,
    fit: { ...fit, score: 60, criteria: [{ ...criteria[0], weight: 50 }, criteria[1]] },
  });
  assert(!broken.ok);
  expect(broken.errors).toContainEqual(expect.stringContaining('"fit.criteria"'));
  const lonely = validateApplicationConfig({ ...base, fit: { ...fit, exclusion: 'Freelance' } });
  assert(!lonely.ok);
  expect(lonely.errors).toContainEqual(expect.stringContaining('"fit.exclusion"'));
});

test('a fit without a breakdown gets no criteria or exclusion keys', () => {
  const result = validateApplicationConfig({ ...base, fit });
  assert(result.ok);
  expect(result.config.fit!).not.toHaveProperty('criteria');
  expect(result.config.fit!).not.toHaveProperty('exclusion');
});
