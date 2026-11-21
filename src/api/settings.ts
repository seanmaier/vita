// The account's settings as server state (see server/routes/settings.ts).
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useBackend, type Settings } from './backend';

export const settingsKey = ['settings'] as const;

export function useSettings() {
  const backend = useBackend().settings;
  return useQuery({ queryKey: settingsKey, queryFn: backend.get });
}

export function useMarkTourSeen() {
  const backend = useBackend().settings;
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: backend.markTourSeen,
    onSuccess: (settings: Settings) => queryClient.setQueryData(settingsKey, settings),
  });
}
