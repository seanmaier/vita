// Plain helpers around base profiles; the profiles themselves come from
// src/api/baseProfiles.ts (useAllBaseProfiles etc.).
import type { AppLanguage, ApplicationConfig, BaseProfile, Profile } from '#shared/types.ts';
import type { LanguageProfiles } from '../api/languageProfiles';
import type { AppRecord } from '../api/applications';
import { slugify, uniqueId } from '#shared/utils/slug.ts';
import { TRASH_RETENTION_DAYS } from '#shared/utils/trash.ts';
import { LANGUAGE_LABELS } from '#shared/utils/language.ts';

/** The confirmation shown before moving a profile to the trash, warning about applications that use it. */
export function trashConfirmMessage(profile: BaseProfile, records: AppRecord[]): string {
  const usedBy = applicationsUsingBaseProfile(profile.id, records);
  const retention = `${TRASH_RETENTION_DAYS} days`;
  if (usedBy.length === 0) return `Move "${profile.name}" to the trash? You can restore it there for ${retention}.`;
  return (
    `Move "${profile.name}" to the trash? It's used by ${usedBy.length} application${usedBy.length === 1 ? '' : 's'} ` +
    `(${usedBy.map((a) => a.company).join(', ')}). They keep using it while it's in the trash and fall back to ` +
    `the language default profile once it's deleted for good after ${retention}.`
  );
}

// Trashed profiles keep their id until purged, so a restore never collides.
export function uniqueBaseProfileId(name: string, all: BaseProfile[]): string {
  return uniqueId(slugify(name) || 'profile', new Set(all.map((p) => p.id)));
}

export function blankProfile(language: AppLanguage): Profile {
  return {
    name: '',
    role: '',
    email: '',
    website: '',
    github: '',
    linkedin: '',
    city: '',
    summary: '',
    experience: [],
    projects: [],
    education: { degree: '', school: '', dates: '' },
    skillGroups: [],
    languages: [{ name: LANGUAGE_LABELS[language], level: '' }],
    interests: [],
  };
}

// Applications (bundled and the user's, not trashed) that currently point at
// this base profile — used to warn before deleting one that's still in use.
// The profile is usually picked in the editor, so its saved edits decide.
export function applicationsUsingBaseProfile(id: string, records: AppRecord[]): ApplicationConfig[] {
  return records
    .filter((r) => !r.app.deletedAt && (r.savedEdits?.baseProfileId ?? r.app.baseProfileId) === id)
    .map((r) => r.app);
}

// Resolves the profile an application should render with: its selected base
// profile when set (falling back gracefully if that profile was since
// deleted), otherwise the legacy per-language profile — so applications
// created before this feature (or left on "language default") keep working.
// `baseProfiles` includes trashed ones, so an application using one keeps
// rendering it until it's purged.
export function resolveApplicationProfile(
  app: ApplicationConfig,
  baseProfiles: BaseProfile[],
  languages: LanguageProfiles,
): Profile {
  if (app.baseProfileId) {
    const baseProfile = baseProfiles.find((p) => p.id === app.baseProfileId);
    if (baseProfile) return baseProfile.profile;
  }
  return languages[app.language ?? 'en'];
}
