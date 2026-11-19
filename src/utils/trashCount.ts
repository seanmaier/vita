import { useApplications } from '../api/applications';
import { useDeletedBaseProfiles } from '../api/baseProfiles';

/** Everything currently in the trash, for the "trash (n)" links; 0 until loaded. */
export function useTrashCount(): number {
  const applications = useApplications().data ?? [];
  const profiles = useDeletedBaseProfiles().data ?? [];
  return applications.filter((r) => r.app.deletedAt).length + profiles.length;
}
