import { describe, expect, it } from 'vitest';
import { STORAGE_KEYS } from './storageKeys.ts';

// These names are in every user's database and in their backup files. A test
// that fails here means data stored under the old name would be lost: rename
// a key only together with a migration.
describe('storage keys', () => {
  it('keep the names data is stored under', () => {
    expect([STORAGE_KEYS.localApps, STORAGE_KEYS.baseProfiles, STORAGE_KEYS.tourSeen]).toEqual([
      'local-apps',
      'base-profiles',
      'tour-seen',
    ]);
    expect(STORAGE_KEYS.appConfig('acme')).toBe('app-config-acme');
    expect(STORAGE_KEYS.status('acme')).toBe('status-acme');
    expect(STORAGE_KEYS.statusHistory('acme')).toBe('status-history-acme');
    expect(STORAGE_KEYS.profileOverride('de')).toBe('profile-override-de');
    expect(STORAGE_KEYS.knowledge('priorities')).toBe('knowledge-priorities');
  });
});
