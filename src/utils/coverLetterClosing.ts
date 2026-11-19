import type { AppLanguage } from '#shared/types.ts';

// Used when a cover letter doesn't set its own closing line.
export const DEFAULT_CLOSINGS: Record<AppLanguage, string> = {
  en: 'Sincerely,',
  de: 'Mit freundlichen Grüßen',
  sv: 'Med vänliga hälsningar',
};
