// Base profiles as server state: cached by TanStack Query, refetched when the
// tab comes back into view, and updated from each write's answer.
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { BaseProfile } from '#shared/types.ts';
import { LANGUAGE_LABELS, LANGUAGES } from '#shared/utils/language.ts';
import { getProfile } from '../data/profiles';
import { useBackend } from './backend';

export const baseProfilesKey = ['base-profiles'] as const;

/**
 * One named base profile per language, from the previous single-profile-per-
 * language setup (static file + optional profile override, both merged by
 * getProfile), so existing users keep their edits. Stored the first time a
 * user has no list at all.
 */
function languageDefaults(): BaseProfile[] {
  return LANGUAGES.map((language) => ({
    id: `default-${language}`,
    name: `${LANGUAGE_LABELS[language]} (default)`,
    language,
    profile: getProfile(language),
  }));
}

/** Every base profile, trash included; seeds the language defaults the first time. */
export function useAllBaseProfiles() {
  const backend = useBackend().baseProfiles;
  return useQuery({
    queryKey: baseProfilesKey,
    queryFn: async () => (await backend.list()) ?? backend.seed(languageDefaults()),
  });
}

/** The base profiles to offer and list: everything not in the trash. */
export function useBaseProfiles() {
  const query = useAllBaseProfiles();
  return { ...query, data: query.data?.filter((p) => !p.deletedAt) };
}

/** The base profiles in the trash. */
export function useDeletedBaseProfiles() {
  const query = useAllBaseProfiles();
  return { ...query, data: query.data?.filter((p) => p.deletedAt) };
}

/** Saving, trashing, restoring and deleting; each puts the answer into the cache. */
export function useBaseProfileMutations() {
  const backend = useBackend().baseProfiles;
  const queryClient = useQueryClient();
  const onSuccess = (list: BaseProfile[]) => queryClient.setQueryData(baseProfilesKey, list);
  return {
    save: useMutation({ mutationFn: backend.save, onSuccess }),
    trash: useMutation({ mutationFn: backend.trash, onSuccess }),
    restore: useMutation({ mutationFn: backend.restore, onSuccess }),
    remove: useMutation({ mutationFn: backend.remove, onSuccess }),
  };
}
