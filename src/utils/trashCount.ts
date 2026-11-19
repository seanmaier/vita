import { useDeletedBaseProfiles } from '../api/baseProfiles';
import { getDeletedLocalApplications } from './localApplications';

/** Everything currently in the trash, for the "trash (n)" links. Recounted on every render. */
export function useTrashCount(): number {
  const profiles = useDeletedBaseProfiles().data ?? [];
  return getDeletedLocalApplications().length + profiles.length;
}
