// The per-criterion breakdown of a job check (see /stellencheck), shared by
// the application `fit` and the job leads so both validate it the same way.
import { z } from 'zod';
import type { FitCriterion } from '#shared/types.ts';
import { check } from '#shared/validation/issues.ts';

const MAX_CRITERIA = 20;
const MAX_EXCLUSION = 500;

/** The score a breakdown adds up to: Σ weight × fulfilled / 100, rounded. */
export function criteriaScore(criteria: FitCriterion[]): number {
  return Math.round(criteria.reduce((sum, c) => sum + c.weight * c.fulfilled, 0) / 100);
}

const percentInt = () => {
  const error = 'must be an integer from 0 to 100.';
  return z.number({ error }).refine((n) => Number.isInteger(n) && n >= 0 && n <= 100, { error });
};

const criterion = z.preprocess(
  // Anything that isn't an object reads as an empty one, so each field reports what it lacks.
  (v) => (typeof v === 'object' && v !== null ? v : {}),
  z.object({
    name: z.string({ error: 'must be a non-empty string.' }).trim().min(1, { error: 'must be a non-empty string.' }),
    weight: percentInt(),
    fulfilled: percentInt(),
  }),
);

const trimmedName = (v: unknown) =>
  typeof v === 'object' && v !== null && typeof (v as { name?: unknown }).name === 'string' ? (v as { name: string }).name.trim() : '';

/** A rating's per-criterion breakdown: 1–20 criteria with unique names whose weights add up to 100. */
export const criteriaSchema: z.ZodType<FitCriterion[]> = z
  .array(z.unknown(), { error: `must be a list of 1 to ${MAX_CRITERIA} criteria.` })
  .min(1, { error: `must be a list of 1 to ${MAX_CRITERIA} criteria.` })
  .max(MAX_CRITERIA, { error: `must be a list of 1 to ${MAX_CRITERIA} criteria.` })
  .pipe(
    z
      .array(criterion)
      // Reported together with the other errors of each criterion.
      .superRefine(
        (items, ctx) => {
          const seen = new Set<string>();
          items.forEach((item, i) => {
            const name = trimmedName(item);
            if (name && seen.has(name)) ctx.addIssue({ code: 'custom', path: [i, 'name'], message: `"${name}" appears twice.` });
            seen.add(name);
          });
        },
        { when: () => true },
      )
      // Only once every criterion is valid and no name repeats.
      .superRefine((items, ctx) => {
        if (new Set(items.map((c) => c.name)).size < items.length) return;
        const total = items.reduce((sum, c) => sum + c.weight, 0);
        if (total !== 100) ctx.addIssue({ code: 'custom', message: `weights must add up to 100 (got ${total}).` });
      }),
  );

/** The exclusion criterion that applied: a non-empty string of at most 500 characters, trimmed. */
export const exclusionSchema = z
  .string({ error: `must be a non-empty string of at most ${MAX_EXCLUSION} characters.` })
  .trim()
  .min(1, { error: `must be a non-empty string of at most ${MAX_EXCLUSION} characters.` })
  .max(MAX_EXCLUSION, { error: `must be a non-empty string of at most ${MAX_EXCLUSION} characters.` });

/** Checks a breakdown; pushes messages prefixed with `field` and returns undefined on any error. */
export function validateCriteria(value: unknown, field: string, errors: string[]): FitCriterion[] | undefined {
  const result = check(criteriaSchema, value, 'quoted', [field]);
  if (result.ok) return result.value;
  errors.push(...result.errors);
  return undefined;
}

/** Checks the exclusion criterion that applied; pushes a message prefixed with `field` on error. */
export function validateExclusion(value: unknown, field: string, errors: string[]): string | undefined {
  const result = check(exclusionSchema, value, 'quoted', [field]);
  if (result.ok) return result.value;
  errors.push(...result.errors);
  return undefined;
}

/** The points one criterion adds to the score: weight × fulfilled / 100, rounded. */
export function criterionPoints(c: FitCriterion): number {
  return Math.round((c.weight * c.fulfilled) / 100);
}

/** The breakdown as plain lines, e.g. for a tooltip. */
export function breakdownText(criteria: FitCriterion[], exclusion?: string): string {
  const lines = criteria.map((c) => `${c.name}: ${c.fulfilled} % × ${c.weight} = ${criterionPoints(c)}`);
  if (exclusion) lines.push(`Excluded: ${exclusion}`);
  return lines.join('\n');
}
