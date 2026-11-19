// The per-criterion breakdown of a job check (see /stellencheck), shared by
// the application `fit` and the job leads so both validate it the same way.
import type { FitCriterion, JobFit } from '#shared/types.ts';

const MAX_CRITERIA = 20;
const MAX_EXCLUSION = 500;

const isPercentInt = (v: unknown): v is number => Number.isInteger(v) && (v as number) >= 0 && (v as number) <= 100;

/** The score a breakdown adds up to: Σ weight × fulfilled / 100, rounded. */
export function criteriaScore(criteria: FitCriterion[]): number {
  return Math.round(criteria.reduce((sum, c) => sum + c.weight * c.fulfilled, 0) / 100);
}

/** Checks a breakdown; pushes messages prefixed with `field` and returns undefined on any error. */
export function validateCriteria(value: unknown, field: string, errors: string[]): FitCriterion[] | undefined {
  if (!Array.isArray(value) || value.length < 1 || value.length > MAX_CRITERIA) {
    errors.push(`"${field}" must be a list of 1 to ${MAX_CRITERIA} criteria.`);
    return undefined;
  }
  const before = errors.length;
  const names = new Set<string>();
  const criteria = value.map((entry, i): FitCriterion => {
    const c = (entry ?? {}) as Record<string, unknown>;
    const name = typeof c.name === 'string' ? c.name.trim() : '';
    if (!name) errors.push(`"${field}[${i}].name" must be a non-empty string.`);
    else if (names.has(name)) errors.push(`"${field}[${i}].name" "${name}" appears twice.`);
    names.add(name);
    if (!isPercentInt(c.weight)) errors.push(`"${field}[${i}].weight" must be an integer from 0 to 100.`);
    if (!isPercentInt(c.fulfilled)) errors.push(`"${field}[${i}].fulfilled" must be an integer from 0 to 100.`);
    return { name, weight: c.weight as number, fulfilled: c.fulfilled as number };
  });
  if (errors.length > before) return undefined;
  const total = criteria.reduce((sum, c) => sum + c.weight, 0);
  if (total !== 100) {
    errors.push(`"${field}" weights must add up to 100 (got ${total}).`);
    return undefined;
  }
  return criteria;
}

/** Checks the exclusion criterion that applied: a non-empty string of at most 500 characters. */
export function validateExclusion(value: unknown, field: string, errors: string[]): string | undefined {
  const text = typeof value === 'string' ? value.trim() : '';
  if (!text || text.length > MAX_EXCLUSION) {
    errors.push(`"${field}" must be a non-empty string of at most ${MAX_EXCLUSION} characters.`);
    return undefined;
  }
  return text;
}

/** The points one criterion adds to the score: weight × fulfilled / 100, rounded. */
export function criterionPoints(c: FitCriterion): number {
  return Math.round((c.weight * c.fulfilled) / 100);
}

/** The score that counts: after a cap from the priorities, if one applied. */
export function fitScore(fit: JobFit): number {
  return fit.cappedScore ?? fit.score;
}

/** The breakdown as plain lines, e.g. for a tooltip. */
export function breakdownText(criteria: FitCriterion[], exclusion?: string): string {
  const lines = criteria.map((c) => `${c.name}: ${c.fulfilled} % × ${c.weight} = ${criterionPoints(c)}`);
  if (exclusion) lines.push(`Excluded: ${exclusion}`);
  return lines.join('\n');
}
