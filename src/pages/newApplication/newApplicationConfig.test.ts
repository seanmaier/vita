import { describe, expect, it } from 'vitest';
import { newApplicationConfig, type NewApplicationForm } from './newApplicationConfig.ts';

const form: NewApplicationForm = {
  company: 'Kaiwerk Studio',
  role: 'Fullstack Developer',
  url: '',
  language: 'en',
  font: 'serif',
  featuredIds: ['a'],
  hasCoverLetter: false,
  dateISO: '',
  subjectRole: '',
  paragraphs: [''],
};

describe('newApplicationConfig', () => {
  it('starts a draft with an id from the company and leaves out what was not filled in', () => {
    expect(newApplicationConfig(form)).toEqual({
      id: 'kaiwerk-studio',
      company: 'Kaiwerk Studio',
      role: 'Fullstack Developer',
      status: 'drafting',
      language: 'en',
      font: 'serif',
      featuredProjectIds: ['a'],
    });
  });

  it('falls back to a placeholder id while there is no company yet', () => {
    expect(newApplicationConfig({ ...form, company: '' }).id).toBe('new-app');
  });

  it('addresses the cover letter to the company, with the role as subject unless another is given', () => {
    const config = newApplicationConfig({ ...form, hasCoverLetter: true, dateISO: '2026-11-18', paragraphs: ['Hello', ''] });
    expect(config.coverLetter).toEqual({
      recipientOrg: 'Kaiwerk Studio',
      date: 'November 18, 2026',
      subjectRole: 'Fullstack Developer',
      paragraphs: ['Hello'],
    });
  });
});
