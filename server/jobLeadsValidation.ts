// Pure validation for job leads, shared by the POST and PATCH routes.
import { z } from 'zod';
import type { FitCriterion, JobLeadInput, JobLeadSource, JobLeadStatus } from '#shared/types.ts';
import { criteriaScore, validateCriteria, validateExclusion } from '#shared/utils/fitCriteria.ts';
import { check } from '#shared/validation/issues.ts';
import type { Body, Validated } from './http.ts';

export const LEAD_SOURCES = [
  'linkedin',
  'stepstone',
  'indeed',
  'glassdoor',
  'instaffo',
  'arbeitsagentur',
  'other',
] as const satisfies readonly JobLeadSource[];
export const LEAD_STATUSES = ['new', 'rated', 'dismissed', 'applied'] as const satisfies readonly JobLeadStatus[];

/** A trimmed string of min–max characters. */
const trimmed = (min: number, max: number) =>
  z
    .string({ error: 'must be a string' })
    .trim()
    .refine((s) => s.length >= min && s.length <= max, { error: `must be ${min}-${max} characters` });

/** An optional text: missing, null and blank all mean "not given". */
const optionalText = trimmed(0, 200)
  .nullish()
  .transform((s) => s || undefined);

const leadSchema: z.ZodType<JobLeadInput> = z
  .strictObject(
    {
      source: z.enum(LEAD_SOURCES, { error: `must be one of ${LEAD_SOURCES.join(', ')}` }),
      externalId: trimmed(1, 200),
      title: trimmed(1, 300),
      company: optionalText,
      location: optionalText,
      url: z.preprocess(
        (v) => (typeof v === 'string' ? v.trim() : ''),
        z
          .string()
          .startsWith('https://', { error: 'must start with https://', abort: true })
          .refine((url) => URL.canParse(url), { error: 'must be a valid URL' }),
      ),
    },
    {
      error: (issue) =>
        issue.code === 'unrecognized_keys' ? `unknown field(s): ${issue.keys.join(', ')}` : 'must be an object',
    },
  )
  .transform(({ source, externalId, title, company, location, url }) => ({
    source,
    externalId,
    title,
    url,
    ...(company && { company }),
    ...(location && { location }),
  }));

export function validateLeadInput(input: unknown): Validated<JobLeadInput> {
  return check(leadSchema, input, 'colon');
}

export interface LeadPatch {
  status?: JobLeadStatus;
  score?: number | null;
  verdict?: string | null;
  applicationId?: string | null;
  /** The breakdown of the rating; only together with `score`, null removes it. */
  criteria?: FitCriterion[] | null;
  exclusion?: string | null;
}

export const PATCH_FIELDS = ['status', 'score', 'verdict', 'applicationId', 'criteria', 'exclusion'] as const;

// The plain fields of a patch; criteria and exclusion depend on each other
// and on the score, so validateRating checks those.
const patchSchema = z.object({
  status: z.enum(LEAD_STATUSES, { error: `must be one of ${LEAD_STATUSES.join(', ')}` }).optional(),
  score: z
    .number({ error: 'must be an integer 0-100 or null' })
    .refine((n) => Number.isInteger(n) && n >= 0 && n <= 100, { error: 'must be an integer 0-100 or null' })
    .nullable()
    .optional(),
  verdict: z
    .string({ error: 'must be a string of at most 1000 characters or null' })
    .max(1000, { error: 'must be a string of at most 1000 characters or null' })
    .nullable()
    .optional(),
  applicationId: z
    .string({ error: 'must be a string of 1-200 characters or null' })
    .refine((s) => s.length >= 1 && s.length <= 200, { error: 'must be a string of 1-200 characters or null' })
    .nullable()
    .optional(),
});

export function validatePatch(body: Body): Validated<LeadPatch> {
  if (!Object.keys(body).length) return { ok: false, errors: [`Provide at least one of: ${PATCH_FIELDS.join(', ')}.`] };
  const errors: string[] = [];
  const plain = check(patchSchema, body, 'colon');
  // Only the fields that were sent and are valid, so validateRating still sees a valid score.
  const patch: LeadPatch = {};
  if (plain.ok) {
    for (const key of ['status', 'score', 'verdict', 'applicationId'] as const) {
      if (key in body) Object.assign(patch, { [key]: plain.value[key] });
    }
  } else {
    errors.push(...plain.errors);
    const score = patchSchema.shape.score.safeParse(body.score);
    if ('score' in body && score.success) patch.score = score.data;
  }
  validateRating(body, patch, errors);
  return errors.length ? { ok: false, errors } : { ok: true, value: patch };
}

/** The criteria breakdown must come with the score it explains; the score may sit below it after a cap. */
function validateRating(body: Body, patch: LeadPatch, errors: string[]): void {
  if ('criteria' in body && body.criteria !== null) {
    const criteria = validateCriteria(body.criteria, 'criteria', errors);
    if (typeof patch.score !== 'number') errors.push('criteria: needs a score in the same request');
    else if (criteria && patch.score > criteriaScore(criteria) + 1) {
      errors.push(`score: must not exceed the criteria breakdown (${criteriaScore(criteria)})`);
    }
    if (criteria) patch.criteria = criteria;
  } else if ('criteria' in body) patch.criteria = null;
  if ('exclusion' in body) {
    // Also for null: an exclusion only ever travels with its breakdown.
    if (!patch.criteria) errors.push('exclusion: needs a criteria breakdown');
    else if (body.exclusion !== null) {
      const exclusion = validateExclusion(body.exclusion, 'exclusion', errors);
      if (exclusion) patch.exclusion = exclusion;
    }
  }
}
