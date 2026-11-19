import assert from 'node:assert/strict';
import { test } from 'node:test';
import { breakdownText, criteriaScore, criterionPoints, validateCriteria, validateExclusion } from './fitCriteria.ts';

const criteria = [
  { name: 'A', weight: 60, fulfilled: 50 },
  { name: 'B', weight: 40, fulfilled: 75 },
];

function check(value: unknown) {
  const errors: string[] = [];
  const result = validateCriteria(value, 'fit.criteria', errors);
  return { result, errors };
}

test('the score of a breakdown is the rounded weighted sum', () => {
  assert.equal(criteriaScore(criteria), 60);
  assert.equal(
    criteriaScore([
      { name: 'A', weight: 15, fulfilled: 50 },
      { name: 'B', weight: 85, fulfilled: 0 },
    ]),
    8,
  );
});

test('a valid breakdown is returned with trimmed names', () => {
  const { result, errors } = check([{ name: ' A ', weight: 60, fulfilled: 50 }, criteria[1]]);
  assert.deepEqual(errors, []);
  assert.deepEqual(result, criteria);
});

test('a breakdown is rejected unless it is a list of 1 to 20 criteria', () => {
  const many = Array.from({ length: 21 }, (_, i) => ({ name: `C${i}`, weight: i === 0 ? 80 : 1, fulfilled: 50 }));
  for (const value of [[], many, 'A', null]) {
    const { result, errors } = check(value);
    assert.equal(result, undefined);
    assert.ok(
      errors.some((e) => e.startsWith('"fit.criteria"')),
      String(value),
    );
  }
});

test('a breakdown is rejected for bad names, numbers or a weight sum other than 100', () => {
  const cases = [
    [criteria[0], { ...criteria[1], name: 'A' }],
    [criteria[0], { ...criteria[1], name: '  ' }],
    [criteria[0], { ...criteria[1], weight: 39 }],
    [criteria[0], { ...criteria[1], fulfilled: 50.5 }],
    [criteria[0], { ...criteria[1], weight: '40' }],
    [criteria[0], { ...criteria[1], fulfilled: 101 }],
    [criteria[0], 'B'],
  ];
  for (const value of cases) {
    const { result, errors } = check(value);
    assert.equal(result, undefined, JSON.stringify(value));
    assert.ok(errors.length > 0);
  }
});

test('an exclusion is a non-empty string of at most 500 characters', () => {
  const run = (value: unknown) => {
    const errors: string[] = [];
    return { result: validateExclusion(value, 'fit.exclusion', errors), errors };
  };
  assert.deepEqual(run(' Freelance '), { result: 'Freelance', errors: [] });
  for (const value of ['', '   ', 'x'.repeat(501), 3]) {
    const { result, errors } = run(value);
    assert.equal(result, undefined);
    assert.ok(errors[0].startsWith('"fit.exclusion"'));
  }
});

test('a criterion earns its weight times its fulfilment, rounded', () => {
  assert.equal(criterionPoints({ name: 'A', weight: 15, fulfilled: 50 }), 8);
  assert.equal(criterionPoints({ name: 'A', weight: 20, fulfilled: 75 }), 15);
});

test('the breakdown text lists each criterion and the exclusion', () => {
  assert.equal(breakdownText(criteria), 'A: 50 % × 60 = 30\nB: 75 % × 40 = 30');
  assert.equal(breakdownText(criteria, 'Freelance'), 'A: 50 % × 60 = 30\nB: 75 % × 40 = 30\nExcluded: Freelance');
});
