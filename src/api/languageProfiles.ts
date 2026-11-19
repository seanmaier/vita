// The language default profiles: the bundled profile per language, or the
// user's old edit to it from before base profiles existed.
import { useQuery } from '@tanstack/react-query';
import type { AppLanguage, Profile } from '#shared/types.ts';
import { LANGUAGES } from '#shared/utils/language.ts';
import { getStaticProfile } from '../data/profiles';
import { useBackend, type ProfileOverrides } from './backend';

export const profileOverridesKey = ['profile-overrides'] as const;

export type LanguageProfiles = Record<AppLanguage, Profile>;

/** Each language's default profile, with the user's old edit to it where there is one. */
export function languageProfiles(overrides: ProfileOverrides): LanguageProfiles {
  return Object.fromEntries(LANGUAGES.map((l) => [l, overrides[l] ?? getStaticProfile(l)])) as LanguageProfiles;
}

export function useLanguageProfiles() {
  const backend = useBackend().profileOverrides;
  return useQuery({ queryKey: profileOverridesKey, queryFn: backend.list, select: languageProfiles });
}
