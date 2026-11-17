// Pure validation for job leads, shared by the POST and PATCH routes.
import type { FitCriterion, JobLeadInput, JobLeadSource, JobLeadStatus } from '../src/types.ts';
import { criteriaScore, validateCriteria, validateExclusion } from '../src/utils/fitCriteria.ts';
import { isPlainObject, type Body, type Validated } from './http.ts';

export const LEAD_SOURCES: readonly JobLeadSource[] = ['linkedin', 'stepstone', 'indeed', 'glassdoor', 'arbeitsagentur', 'other'];
export const LEAD_STATUSES: readonly JobLeadStatus[] = ['new', 'rated', 'dismissed', 'applied'];

const LEAD_FIELDS = ['source', 'externalId', 'title', 'company', 'location', 'url'];

function trimmed(input: Body, field: string, min: number, max: number, errors: string[]): string {
  const v = input[field];
  if (typeof v !== 'string') {
    errors.push(`${field}: must be a string`);
    return '';
  }
  const t = v.trim();
  if (t.length < min || t.length > max) errors.push(`${field}: must be ${min}-${max} characters`);
  return t;
}

function optional(input: Body, field: string, errors: string[]): string | undefined {
  if (input[field] === undefined || input[field] === null) return undefined;
  return trimmed(input, field, 0, 200, errors) || undefined;
}

export function validateLeadInput(input: unknown): Validated<JobLeadInput> {
  if (!isPlainObject(input)) return { ok: false, errors: ['must be an object'] };
  const errors: string[] = [];
  const unknown = Object.keys(input).filter((k) => !LEAD_FIELDS.includes(k));
  if (unknown.length) errors.push(`unknown field(s): ${unknown.join(', ')}`);
  if (!LEAD_SOURCES.includes(input.source as JobLeadSource)) {
    errors.push(`source: must be one of ${LEAD_SOURCES.join(', ')}`);
  }
  const externalId = trimmed(input, 'externalId', 1, 200, errors);
  const title = trimmed(input, 'title', 1, 300, errors);
  const company = optional(input, 'company', errors);
  const location = optional(input, 'location', errors);
  const url = typeof input.url === 'string' ? input.url.trim() : '';
  if (!url.startsWith('https://')) errors.push('url: must start with https://');
  else if (!URL.canParse(url)) errors.push('url: must be a valid URL');
  if (errors.length) return { ok: false, errors };
  const value: JobLeadInput = { source: input.source as JobLeadSource, externalId, title, url };
  if (company) value.company = company;
  if (location) value.location = location;
  return { ok: true, value };
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

export const PATCH_FIELDS = ['status', 'score', 'verdict', 'applicationId', 'criteria', 'exclusion'];

export function validatePatch(body: Body): Validated<LeadPatch> {
  const errors: string[] = [];
  const patch: LeadPatch = {};
  if (!Object.keys(body).length) return { ok: false, errors: [`Provide at least one of: ${PATCH_FIELDS.join(', ')}.`] };
  if ('status' in body) {
    if (LEAD_STATUSES.includes(body.status as JobLeadStatus)) patch.status = body.status as JobLeadStatus;
    else errors.push(`status: must be one of ${LEAD_STATUSES.join(', ')}`);
  }
  if ('score' in body) {
    const s = body.score;
    if (s === null || (typeof s === 'number' && Number.isInteger(s) && s >= 0 && s <= 100)) patch.score = s;
    else errors.push('score: must be an integer 0-100 or null');
  }
  if ('verdict' in body) {
    const v = body.verdict;
    if (v === null || (typeof v === 'string' && v.length <= 1000)) patch.verdict = v;
    else errors.push('verdict: must be a string of at most 1000 characters or null');
  }
  if ('applicationId' in body) {
    const a = body.applicationId;
    if (a === null || (typeof a === 'string' && a.length >= 1 && a.length <= 200)) patch.applicationId = a;
    else errors.push('applicationId: must be a string of 1-200 characters or null');
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
