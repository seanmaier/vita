import { describe, expect, it } from 'vitest';
import type { ApplicationConfig, Profile } from '../../types.ts';
import { editFormToConfig, initialEditForm } from './editForm.ts';

const profile: Profile = {
  name: 'Sam', role: 'Developer', email: '', website: '', github: '', linkedin: '', city: '',
  summary: 'Profile summary',
  experience: [],
  projects: [
    { id: 'a', name: 'A', stack: '', description: '' },
    { id: 'b', name: 'B', stack: '', description: '' },
  ],
  education: { degree: '', school: '', dates: '' },
  skillGroups: [{ label: 'Backend', skills: ['Node'] }],
  languages: [],
  interests: [],
};

const app: ApplicationConfig = {
  id: 'acme',
  company: 'Acme',
  role: 'Developer',
  status: 'sent',
  language: 'de',
  appliedDate: '2026-11-01',
  notes: [{ id: 'n1', text: 'Called them' }],
  fit: { score: 70, recommendation: 'apply', reason: 'ok', evaluatedAt: '2026-11-01T00:00:00Z' },
};

describe('initialEditForm', () => {
  it('starts overrides from the profile the application shows, switched off', () => {
    const form = initialEditForm(app, profile);
    expect(form).toMatchObject({
      language: 'de',
      font: 'sans',
      baseProfileId: '',
      hasSummaryOverride: false,
      summaryOverride: 'Profile summary',
      featuredIds: ['a', 'b'],
      hasSkillGroupsOverride: false,
      skillGroupsOverride: profile.skillGroups,
      hasCoverLetter: false,
      paragraphs: [''],
    });
  });
});

describe('editFormToConfig', () => {
  it('keeps what the form does not edit: dates, notes and the fit rating', () => {
    const config = editFormToConfig(initialEditForm(app, profile), app, 'acme');
    expect(config).toMatchObject({ appliedDate: '2026-11-01', notes: app.notes, fit: app.fit });
    expect(config).not.toHaveProperty('status');
  });

  it('only stores overrides that are switched on', () => {
    const form = { ...initialEditForm(app, profile), summaryOverride: 'Changed', hasSkillGroupsOverride: true };
    const config = editFormToConfig(form, app, 'acme');
    expect(config).not.toHaveProperty('summaryOverride');
    expect(config.skillGroupsOverride).toEqual(profile.skillGroups);
  });

  it('builds the cover letter with its defaults and drops empty parts', () => {
    const form = {
      ...initialEditForm(app, profile),
      hasCoverLetter: true,
      dateISO: '2026-11-03',
      recipientOrg: 'Acme GmbH',
      recipientName: '',
      subjectRole: '',
      paragraphs: ['First', '', 'Second'],
      closing: '  Viele Grüße  ',
    };
    expect(editFormToConfig(form, app, 'acme').coverLetter).toEqual({
      recipientOrg: 'Acme GmbH',
      date: '3. November 2026',
      subjectRole: 'Developer',
      paragraphs: ['First', 'Second'],
      closing: 'Viele Grüße',
    });
  });

  it('gives back an unchanged application when nothing was edited', () => {
    const withLetter: ApplicationConfig = {
      ...app,
      featuredProjectIds: ['b'],
      coverLetter: { recipientOrg: 'Acme', date: '3. November 2026', subjectRole: 'Developer', paragraphs: ['Hi'] },
    };
    const { status: _status, ...stored } = withLetter;
    expect(editFormToConfig(initialEditForm(withLetter, profile), withLetter, 'acme')).toEqual({ ...stored, font: 'sans' });
  });
});
