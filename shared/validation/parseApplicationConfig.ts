import { z } from 'zod';
import type { ApplicationConfig, ApplicationStatus, AppFont, AppLanguage, CoverLetter, FitRecommendation, JobFit } from '#shared/types.ts';
import { slugify } from '#shared/utils/slug.ts';
import { LANGUAGE_MESSAGE, LANGUAGES } from '#shared/utils/language.ts';
import { normalizeNotes } from '#shared/utils/notes.ts';
import { criteriaSchema, criteriaScore, exclusionSchema } from '#shared/utils/fitCriteria.ts';
import { check, nonBlank, parseJsonText, percent, stringArray } from './issues.ts';

const STATUSES = ['drafting', 'ready', 'sent', 'interview', 'offer', 'rejected', 'ghosted', 'withdrawn', 'accepted', 'declined', 'evaluated', 'skipped'] as const satisfies readonly ApplicationStatus[];
const FONTS = ['sans', 'serif', 'mono'] as const satisfies readonly AppFont[];
export const FIT_RECOMMENDATIONS = ['apply', 'apply-if', 'unlikely', 'exclude'] as const satisfies readonly FitRecommendation[];

export type ParseResult =
  | { ok: true; config: ApplicationConfig }
  | { ok: false; errors: string[] };

const optionalString = z.string({ error: 'must be a string.' }).optional();

const coverLetterSchema: z.ZodType<CoverLetter> = z
  .object(
    {
      recipientOrg: nonBlank('is required and must be a non-empty string.'),
      date: z.string({ error: 'must be a string.' }),
      subjectRole: z.string({ error: 'must be a string.' }),
      paragraphs: stringArray('must be an array of strings.'),
      recipientName: optionalString,
      closing: optionalString,
    },
    { error: 'must be an object.' },
  )
  .transform(({ recipientName, closing, ...letter }) => ({
    ...letter,
    ...(recipientName && { recipientName }),
    ...(closing && { closing }),
  }));

const fitSchema: z.ZodType<JobFit> = z
  .object(
    {
      score: percent('must be a number from 0 to 100.'),
      cappedScore: percent('must be a number from 0 to 100.').optional(),
      recommendation: z.enum(FIT_RECOMMENDATIONS, { error: `must be one of: ${FIT_RECOMMENDATIONS.join(', ')}.` }),
      reason: nonBlank('must be a non-empty string.'),
      evaluatedAt: z
        .string({ error: 'must be an ISO timestamp.' })
        .refine((s) => !Number.isNaN(Date.parse(s)), { error: 'must be an ISO timestamp.' }),
      criteria: criteriaSchema.optional(),
      // Checked below: it is only valid together with a breakdown.
      exclusion: z.unknown().optional(),
    },
    { error: 'must be an object with score, recommendation, reason and evaluatedAt.' },
  )
  // Also when other fields are wrong, so every error shows at once.
  .superRefine(
    (fit, ctx) => {
      // Runs even when `fit` itself is the wrong type (already reported).
      if (typeof fit !== 'object' || fit === null) return;
      const criteria = criteriaSchema.safeParse(fit.criteria);
      if (criteria.success && typeof fit.score === 'number' && Math.abs(fit.score - criteriaScore(criteria.data)) > 1) {
        ctx.addIssue({ code: 'custom', path: ['score'], message: `must match the criteria breakdown (${criteriaScore(criteria.data)}).` });
      }
      if (fit.exclusion === undefined) return;
      if (fit.criteria === undefined) {
        ctx.addIssue({ code: 'custom', path: ['exclusion'], message: 'needs a "fit.criteria" breakdown.' });
        return;
      }
      for (const issue of exclusionSchema.safeParse(fit.exclusion).error?.issues ?? []) {
        ctx.addIssue({ code: 'custom', path: ['exclusion'], message: issue.message });
      }
    },
    { when: () => true },
  )
  .transform(({ score, cappedScore, recommendation, reason, evaluatedAt, criteria, exclusion }) => ({
    score,
    ...(cappedScore !== undefined && { cappedScore }),
    recommendation,
    reason: reason.trim(),
    evaluatedAt,
    ...(criteria && { criteria }),
    ...(exclusion !== undefined && { exclusion: exclusionSchema.parse(exclusion) }),
  }));

/** An application as stored and imported. Empty optional strings are dropped; a missing id comes from the company. */
const applicationSchema: z.ZodType<ApplicationConfig> = z
  .object(
    {
      company: nonBlank('is required and must be a non-empty string.'),
      role: nonBlank('is required and must be a non-empty string.'),
      // Anything but a non-empty string falls back to the company's slug.
      id: z.unknown().optional(),
      status: z.enum(STATUSES, { error: `must be one of: ${STATUSES.join(', ')}.` }).optional(),
      language: z.enum(LANGUAGES as [AppLanguage, ...AppLanguage[]], { error: LANGUAGE_MESSAGE }).optional(),
      font: z.enum(FONTS, { error: 'must be "sans", "serif", or "mono".' }).optional(),
      appliedDate: optionalString,
      interviewDate: optionalString,
      finalDecisionDate: optionalString,
      url: optionalString,
      baseProfileId: optionalString,
      summaryOverride: optionalString,
      // The current array of notes, or the legacy single free-text string,
      // migrated on the fly.
      notes: z.union([z.string(), z.array(z.unknown())], { error: 'must be a string or an array of notes.' }).optional(),
      featuredProjectIds: stringArray('must be an array of strings.').optional(),
      coverLetter: coverLetterSchema.optional(),
      fit: fitSchema.optional(),
    },
    { error: 'Expected a JSON object.' },
  )
  .transform((input) => {
    const notes = input.notes === undefined ? undefined : normalizeNotes(input.notes);
    return {
      id: typeof input.id === 'string' && input.id.trim() ? input.id : slugify(input.company),
      company: input.company,
      role: input.role,
      status: input.status ?? 'drafting',
      ...(input.language && { language: input.language }),
      ...(input.font && { font: input.font }),
      ...(input.appliedDate && { appliedDate: input.appliedDate }),
      ...(input.interviewDate && { interviewDate: input.interviewDate }),
      ...(input.finalDecisionDate && { finalDecisionDate: input.finalDecisionDate }),
      ...(notes && { notes }),
      ...(input.url && { url: input.url }),
      ...(input.baseProfileId && { baseProfileId: input.baseProfileId }),
      ...(input.summaryOverride && { summaryOverride: input.summaryOverride }),
      ...(input.featuredProjectIds && { featuredProjectIds: input.featuredProjectIds }),
      ...(input.coverLetter && { coverLetter: input.coverLetter }),
      ...(input.fit && { fit: input.fit }),
    };
  });

/** Validates a parsed JSON value against the ApplicationConfig shape, collecting every error found. */
export function validateApplicationConfig(input: unknown): ParseResult {
  const result = check(applicationSchema, input, 'quoted');
  return result.ok ? { ok: true, config: result.value } : result;
}

/** Parses and validates a raw JSON string in one step. */
export function parseApplicationConfig(raw: string): ParseResult {
  const json = parseJsonText(raw);
  return json.ok ? validateApplicationConfig(json.value) : json;
}
