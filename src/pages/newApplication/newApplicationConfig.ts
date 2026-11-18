import type { AppFont, AppLanguage, ApplicationConfig } from '../../types.ts';
import { formatDateLong } from '../../utils/date.ts';
import { applicationIdFor } from '../../utils/slug.ts';

export interface NewApplicationForm {
  company: string;
  role: string;
  url: string;
  language: AppLanguage;
  font: AppFont;
  baseProfileId?: string;
  featuredIds: string[];
  hasCoverLetter: boolean;
  /** YYYY-MM-DD, as the date input takes it. */
  dateISO: string;
  subjectRole: string;
  paragraphs: string[];
}

/** The application the new-application form describes; it starts as a draft addressed to the company. */
export function newApplicationConfig(form: NewApplicationForm): ApplicationConfig {
  return {
    id: applicationIdFor(form.company),
    company: form.company,
    role: form.role,
    status: 'drafting',
    language: form.language,
    font: form.font,
    ...(form.url && { url: form.url }),
    ...(form.baseProfileId && { baseProfileId: form.baseProfileId }),
    ...(form.featuredIds.length > 0 && { featuredProjectIds: form.featuredIds }),
    ...(form.hasCoverLetter && {
      coverLetter: {
        recipientOrg: form.company,
        date: formatDateLong(form.dateISO, form.language),
        subjectRole: form.subjectRole || form.role,
        paragraphs: form.paragraphs.filter(Boolean),
      },
    }),
  };
}
