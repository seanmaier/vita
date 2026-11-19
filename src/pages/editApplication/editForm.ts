// The edit form's state as one object, and the two conversions between it and
// an application: what the form starts with, and what saving it stores.
import type { ApplicationConfig, AppFont, AppLanguage, Profile, SkillGroup } from '#shared/types.ts';
import { formatDateLong, parseToIsoDate } from '#shared/utils/date.ts';

export interface EditForm {
  company: string;
  role: string;
  url: string;
  language: AppLanguage;
  font: AppFont;
  /** '' for the language's default profile. */
  baseProfileId: string;
  hasSummaryOverride: boolean;
  summaryOverride: string;
  featuredIds: string[];
  hasSkillGroupsOverride: boolean;
  skillGroupsOverride: SkillGroup[];
  hasCoverLetter: boolean;
  /** YYYY-MM-DD, as the date input takes it. */
  dateISO: string;
  recipientOrg: string;
  recipientName: string;
  subjectRole: string;
  paragraphs: string[];
  closing: string;
}

/**
 * The form for an application as it is now. Overrides it doesn't have yet
 * start from `profile`, the one it shows, so switching one on edits a copy.
 */
export function initialEditForm(app: ApplicationConfig, profile: Profile): EditForm {
  return {
    company: app.company,
    role: app.role,
    url: app.url ?? '',
    language: app.language ?? 'en',
    font: app.font ?? 'sans',
    baseProfileId: app.baseProfileId ?? '',
    hasSummaryOverride: !!app.summaryOverride,
    summaryOverride: app.summaryOverride ?? profile.summary,
    featuredIds: app.featuredProjectIds ?? profile.projects.map((p) => p.id),
    hasSkillGroupsOverride: !!app.skillGroupsOverride,
    skillGroupsOverride: app.skillGroupsOverride ?? profile.skillGroups,
    hasCoverLetter: !!app.coverLetter,
    dateISO: parseToIsoDate(app.coverLetter?.date ?? ''),
    recipientOrg: app.coverLetter?.recipientOrg ?? '',
    recipientName: app.coverLetter?.recipientName ?? '',
    subjectRole: app.coverLetter?.subjectRole ?? '',
    paragraphs: [...(app.coverLetter?.paragraphs ?? [''])],
    closing: app.coverLetter?.closing ?? '',
  };
}

/** What saving the form stores for the application `app` (with id `id`). */
export function editFormToConfig(
  form: EditForm,
  app: ApplicationConfig,
  id: string,
): Omit<ApplicationConfig, 'status'> {
  return {
    id,
    company: form.company,
    role: form.role,
    language: form.language,
    font: form.font,
    ...(form.baseProfileId && { baseProfileId: form.baseProfileId }),
    ...(form.url && { url: form.url }),
    // The dates follow the status history (changed on the application's
    // timeline). Old values are carried along untouched: they are what an
    // application without a recorded history yet reads its dates from.
    ...(app.appliedDate && { appliedDate: app.appliedDate }),
    ...(app.interviewDate && { interviewDate: app.interviewDate }),
    ...(app.finalDecisionDate && { finalDecisionDate: app.finalDecisionDate }),
    ...(app.notes && { notes: app.notes }),
    // Set by /stellencheck; not editable here, but kept on save.
    ...(app.fit && { fit: app.fit }),
    ...(form.hasSummaryOverride && { summaryOverride: form.summaryOverride }),
    featuredProjectIds: form.featuredIds,
    ...(form.hasSkillGroupsOverride && { skillGroupsOverride: form.skillGroupsOverride }),
    ...(form.hasCoverLetter && {
      coverLetter: {
        recipientOrg: form.recipientOrg,
        ...(form.recipientName && { recipientName: form.recipientName }),
        date: formatDateLong(form.dateISO, form.language),
        subjectRole: form.subjectRole || form.role,
        paragraphs: form.paragraphs.filter(Boolean),
        ...(form.closing.trim() && { closing: form.closing.trim() }),
      },
    }),
  };
}
