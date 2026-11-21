// The profiles an application can render with, for pages that need both kinds.
import type { BaseProfile } from '#shared/types.ts';
import { useAllBaseProfiles } from './baseProfiles';
import { combine } from './combine';
import { useLanguageProfiles, type LanguageProfiles } from './languageProfiles';

export interface Profiles {
  /** Every base profile, trash included. */
  baseProfiles: BaseProfile[];
  /** For applications without a base profile. */
  languages: LanguageProfiles;
}

/** Base profiles and language defaults together, shaped like a query for QueryState. */
export function useProfiles() {
  return combine({ baseProfiles: useAllBaseProfiles(), languages: useLanguageProfiles() });
}
