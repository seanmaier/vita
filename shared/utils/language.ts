import type { AppLanguage } from '#shared/types.ts';

export const LANGUAGES: AppLanguage[] = ['en', 'de', 'sv'];

/** Each language's own name for itself, as shown in pickers. */
export const LANGUAGE_LABELS: Record<AppLanguage, string> = { en: 'English', de: 'Deutsch', sv: 'Svenska' };

export const LANG_FLAGS: Record<AppLanguage, string> = { en: '🇬🇧', de: '🇩🇪', sv: '🇸🇪' };

/** Applications written before the field existed are English. */
export function languageOf(app: { language?: AppLanguage }): AppLanguage {
  return app.language ?? 'en';
}

export function isAppLanguage(value: unknown): value is AppLanguage {
  return LANGUAGES.includes(value as AppLanguage);
}

/** The end of the message for an unknown language, after the field's name. */
export const LANGUAGE_MESSAGE = `must be one of ${LANGUAGES.map((l) => `"${l}"`).join(', ')}.`;
/** The validation message for a field that must hold one of LANGUAGES. */
export const LANGUAGE_ERROR = `"language" ${LANGUAGE_MESSAGE}`;
