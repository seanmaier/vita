import { deleteExpiredSessions } from './auth.ts';
import { purgeOldInboundEvents } from './inboundMail.ts';
import { log } from './log.ts';
import { purgeTrash } from './trash.ts';

/**
 * Hourly housekeeping (scheduled by server/index.ts). Trashed applications and
 * base profiles are purged within an hour of their retention period running
 * out (TRASH_RETENTION_DAYS in src/utils/trash.ts).
 */
export function housekeeping() {
  try {
    deleteExpiredSessions();
    purgeOldInboundEvents();
    const purged = purgeTrash();
    if (purged.applications || purged.baseProfiles) {
      log.info('Purged trash', { applications: purged.applications, baseProfiles: purged.baseProfiles });
    }
  } catch (err) {
    // Logged and retried next hour instead of taking the server down.
    log.error('Housekeeping failed', {}, err);
  }
}
