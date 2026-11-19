import type { ApplicationConfig, ApplicationStatus, AppLanguage, AppFont, CoverLetter, FitRecommendation, JobFit, Note } from '#shared/types.ts';
import { slugify } from '#shared/utils/slug.ts';
import { isAppLanguage, LANGUAGE_ERROR } from '#shared/utils/language.ts';
import { normalizeNotes } from '#shared/utils/notes.ts';
import { criteriaScore, validateCriteria, validateExclusion } from '#shared/utils/fitCriteria.ts';

const STATUSES: ApplicationStatus[] = ['drafting', 'ready', 'sent', 'interview', 'offer', 'rejected', 'ghosted', 'withdrawn', 'accepted', 'declined', 'evaluated', 'skipped'];
const FONTS: AppFont[] = ['sans', 'serif', 'mono'];
export const FIT_RECOMMENDATIONS: FitRecommendation[] = ['apply', 'apply-if', 'unlikely', 'exclude'];

export type ParseResult =
  | { ok: true; config: ApplicationConfig }
  | { ok: false; errors: string[] };

function isString(v: unknown): v is string {
  return typeof v === 'string';
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function validateCoverLetter(value: unknown, errors: string[]): CoverLetter | undefined {
  if (value === undefined) return undefined;
  if (!isPlainObject(value)) {
    errors.push('"coverLetter" must be an object.');
    return undefined;
  }
  const clErrors: string[] = [];
  if (!isString(value.recipientOrg) || !value.recipientOrg.trim()) clErrors.push('"coverLetter.recipientOrg" is required and must be a non-empty string.');
  if (!isString(value.date)) clErrors.push('"coverLetter.date" must be a string.');
  if (!isString(value.subjectRole)) clErrors.push('"coverLetter.subjectRole" must be a string.');
  if (!Array.isArray(value.paragraphs) || !value.paragraphs.every(isString)) clErrors.push('"coverLetter.paragraphs" must be an array of strings.');
  if (value.recipientName !== undefined && !isString(value.recipientName)) clErrors.push('"coverLetter.recipientName" must be a string.');
  if (value.closing !== undefined && !isString(value.closing)) clErrors.push('"coverLetter.closing" must be a string.');

  errors.push(...clErrors);
  if (clErrors.length > 0) return undefined;

  return {
    recipientOrg: value.recipientOrg as string,
    date: value.date as string,
    subjectRole: value.subjectRole as string,
    paragraphs: value.paragraphs as string[],
    ...(isString(value.recipientName) && value.recipientName && { recipientName: value.recipientName }),
    ...(isString(value.closing) && value.closing && { closing: value.closing }),
  };
}

const isPercent = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= 100;

function validateFit(value: unknown, errors: string[]): JobFit | undefined {
  if (value === undefined) return undefined;
  if (!isPlainObject(value)) {
    errors.push('"fit" must be an object with score, recommendation, reason and evaluatedAt.');
    return undefined;
  }
  const before = errors.length;
  if (!isPercent(value.score)) errors.push('"fit.score" must be a number from 0 to 100.');
  if (value.cappedScore !== undefined && !isPercent(value.cappedScore)) errors.push('"fit.cappedScore" must be a number from 0 to 100.');
  if (!FIT_RECOMMENDATIONS.includes(value.recommendation as FitRecommendation)) {
    errors.push(`"fit.recommendation" must be one of: ${FIT_RECOMMENDATIONS.join(', ')}.`);
  }
  if (!isString(value.reason) || !value.reason.trim()) errors.push('"fit.reason" must be a non-empty string.');
  if (!isString(value.evaluatedAt) || Number.isNaN(Date.parse(value.evaluatedAt))) {
    errors.push('"fit.evaluatedAt" must be an ISO timestamp.');
  }
  const criteria = value.criteria === undefined ? undefined : validateCriteria(value.criteria, 'fit.criteria', errors);
  if (criteria && isPercent(value.score) && Math.abs(value.score - criteriaScore(criteria)) > 1) {
    errors.push(`"fit.score" must match the criteria breakdown (${criteriaScore(criteria)}).`);
  }
  let exclusion: string | undefined;
  if (value.exclusion !== undefined) {
    if (value.criteria === undefined) errors.push('"fit.exclusion" needs a "fit.criteria" breakdown.');
    else exclusion = validateExclusion(value.exclusion, 'fit.exclusion', errors);
  }
  if (errors.length > before) return undefined;
  return {
    score: value.score as number,
    ...(value.cappedScore !== undefined && { cappedScore: value.cappedScore as number }),
    recommendation: value.recommendation as FitRecommendation,
    reason: (value.reason as string).trim(),
    evaluatedAt: value.evaluatedAt as string,
    ...(criteria && { criteria }),
    ...(exclusion && { exclusion }),
  };
}

/** Validates a parsed JSON value against the ApplicationConfig shape, collecting every error found. */
export function validateApplicationConfig(input: unknown): ParseResult {
  if (!isPlainObject(input)) {
    return { ok: false, errors: ['Expected a JSON object.'] };
  }

  const errors: string[] = [];

  if (!isString(input.company) || !input.company.trim()) errors.push('"company" is required and must be a non-empty string.');
  if (!isString(input.role) || !input.role.trim()) errors.push('"role" is required and must be a non-empty string.');

  const id = isString(input.id) && input.id.trim()
    ? input.id
    : slugify(isString(input.company) ? input.company : '');

  let status: ApplicationStatus = 'drafting';
  if (input.status !== undefined) {
    if (!isString(input.status) || !STATUSES.includes(input.status as ApplicationStatus)) {
      errors.push(`"status" must be one of: ${STATUSES.join(', ')}.`);
    } else {
      status = input.status as ApplicationStatus;
    }
  }

  let language: AppLanguage | undefined;
  if (input.language !== undefined) {
    if (!isAppLanguage(input.language)) {
      errors.push(LANGUAGE_ERROR);
    } else {
      language = input.language;
    }
  }

  let font: AppFont | undefined;
  if (input.font !== undefined) {
    if (!isString(input.font) || !FONTS.includes(input.font as AppFont)) {
      errors.push('"font" must be "sans", "serif", or "mono".');
    } else {
      font = input.font as AppFont;
    }
  }

  for (const key of ['appliedDate', 'interviewDate', 'finalDecisionDate', 'url', 'baseProfileId', 'summaryOverride'] as const) {
    if (input[key] !== undefined && !isString(input[key])) {
      errors.push(`"${key}" must be a string.`);
    }
  }

  // Accepts both the current array-of-notes shape and the legacy single
  // free-text string, migrating the latter on the fly.
  let notes: Note[] | undefined;
  if (input.notes !== undefined) {
    if (isString(input.notes) || Array.isArray(input.notes)) {
      notes = normalizeNotes(input.notes);
    } else {
      errors.push('"notes" must be a string or an array of notes.');
    }
  }

  if (input.featuredProjectIds !== undefined
    && (!Array.isArray(input.featuredProjectIds) || !input.featuredProjectIds.every(isString))) {
    errors.push('"featuredProjectIds" must be an array of strings.');
  }

  const coverLetter = validateCoverLetter(input.coverLetter, errors);
  const fit = validateFit(input.fit, errors);

  if (errors.length > 0) return { ok: false, errors };

  const config: ApplicationConfig = {
    id,
    company: input.company as string,
    role: input.role as string,
    status,
    ...(language && { language }),
    ...(font && { font }),
    ...(isString(input.appliedDate) && input.appliedDate && { appliedDate: input.appliedDate }),
    ...(isString(input.interviewDate) && input.interviewDate && { interviewDate: input.interviewDate }),
    ...(isString(input.finalDecisionDate) && input.finalDecisionDate && { finalDecisionDate: input.finalDecisionDate }),
    ...(notes && { notes }),
    ...(isString(input.url) && input.url && { url: input.url }),
    ...(isString(input.baseProfileId) && input.baseProfileId && { baseProfileId: input.baseProfileId }),
    ...(isString(input.summaryOverride) && input.summaryOverride && { summaryOverride: input.summaryOverride }),
    ...(Array.isArray(input.featuredProjectIds) && { featuredProjectIds: input.featuredProjectIds as string[] }),
    ...(coverLetter && { coverLetter }),
    ...(fit && { fit }),
  };

  return { ok: true, config };
}

/** Parses and validates a raw JSON string in one step. */
export function parseApplicationConfig(raw: string): ParseResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (e) {
    return { ok: false, errors: [`Invalid JSON: ${(e as SyntaxError).message}`] };
  }
  return validateApplicationConfig(parsed);
}
