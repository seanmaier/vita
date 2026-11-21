import { describe, expect, it } from 'vitest';
import { getStaticProfile } from '../data/profiles';
import { exportAllData } from './dataBackup';

describe('exportAllData', () => {
  it('writes list entries, saved edits and histories the way older backups did', () => {
    const history = [{ to: 'drafting' as const, date: '2026-11-01', recordedAt: '2026-11-01T08:00:00.000Z' }];
    const acme = { id: 'acme', company: 'Acme', role: 'Dev', status: 'drafting' as const };
    const backup = exportAllData({
      baseProfiles: [],
      applications: [
        { id: 'acme', config: acme, savedEdits: { ...acme, role: 'Lead' }, statusHistory: history },
        // One bundled with the app: only its edits are the user's.
        {
          id: 'from-file',
          config: null,
          savedEdits: { id: 'from-file', company: 'F', role: 'Dev' },
          statusHistory: null,
        },
      ],
      profileOverrides: { en: getStaticProfile('en') },
    });
    expect(backup).toMatchObject({
      version: 3,
      localApps: [acme],
      statusHistories: { acme: history },
      configOverrides: { acme: { role: 'Lead' }, 'from-file': { company: 'F' } },
      profileOverrides: { en: getStaticProfile('en') },
    });
  });
});
