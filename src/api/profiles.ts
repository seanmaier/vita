// The profiles an application can render with, for pages that need both kinds.
import type { BaseProfile } from '#shared/types.ts';
import { useAllBaseProfiles } from './baseProfiles';
import { useLanguageProfiles, type LanguageProfiles } from './languageProfiles';

export interface Profiles {
  /** Every base profile, trash included. */
  baseProfiles: BaseProfile[];
  /** For applications without a base profile. */
  languages: LanguageProfiles;
}

/** Base profiles and language defaults together, shaped like a query for QueryState. */
export function useProfiles() {
  const base = useAllBaseProfiles();
  const languages = useLanguageProfiles();
  const data: Profiles | undefined =
    base.data && languages.data ? { baseProfiles: base.data, languages: languages.data } : undefined;
  return {
    data,
    error: base.error ?? languages.error,
    refetch: () => Promise.all([base.refetch(), languages.refetch()]),
  };
}
