import { expect, test } from 'vitest';
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
  expect(criteriaScore(criteria)).toBe(60);
  expect(criteriaScore([{ name: 'A', weight: 15, fulfilled: 50 }, { name: 'B', weight: 85, fulfilled: 0 }])).toBe(8);
});

test('a valid breakdown is returned with trimmed names', () => {
  const { result, errors } = check([{ name: ' A ', weight: 60, fulfilled: 50 }, criteria[1]]);
  expect(errors).toEqual([]);
  expect(result).toEqual(criteria);
});

test('a breakdown is rejected unless it is a list of 1 to 20 criteria', () => {
  const many = Array.from({ length: 21 }, (_, i) => ({ name: `C${i}`, weight: i === 0 ? 80 : 1, fulfilled: 50 }));
  for (const value of [[], many, 'A', null]) {
    const { result, errors } = check(value);
    expect(result).toBe(undefined);
    expect(errors.some((e) => e.startsWith('"fit.criteria"')), String(value)).toBeTruthy();
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
    expect(result, JSON.stringify(value)).toBe(undefined);
    expect(errors.length).toBeGreaterThan(0);
  }
});

test('an exclusion is a non-empty string of at most 500 characters', () => {
  const run = (value: unknown) => {
    const errors: string[] = [];
    return { result: validateExclusion(value, 'fit.exclusion', errors), errors };
  };
  expect(run(' Freelance ')).toEqual({ result: 'Freelance', errors: [] });
  for (const value of ['', '   ', 'x'.repeat(501), 3]) {
    const { result, errors } = run(value);
    expect(result).toBe(undefined);
    expect(errors[0].startsWith('"fit.exclusion"')).toBeTruthy();
  }
});

test('a criterion earns its weight times its fulfilment, rounded', () => {
  expect(criterionPoints({ name: 'A', weight: 15, fulfilled: 50 })).toBe(8);
  expect(criterionPoints({ name: 'A', weight: 20, fulfilled: 75 })).toBe(15);
});

test('the breakdown text lists each criterion and the exclusion', () => {
  expect(breakdownText(criteria)).toBe('A: 50 % × 60 = 30\nB: 75 % × 40 = 30');
  expect(breakdownText(criteria, 'Freelance')).toBe('A: 50 % × 60 = 30\nB: 75 % × 40 = 30\nExcluded: Freelance');
});
