import { describe, expect, it } from 'vitest';
import type { JobLead } from '#shared/types.ts';
import { groupLeads, triageGroup } from './leadTriage.ts';

const lead = (id: number, extra: Partial<JobLead> = {}): JobLead => ({
  id,
  source: 'indeed',
  externalId: `e${id}`,
  title: `Job ${id}`,
  url: `https://example.com/${id}`,
  receivedAt: '2026-11-19 05:00:00',
  status: 'rated',
  score: 60,
  verdict: null,
  ratedAt: '2026-11-19 05:01:00',
  applicationId: null,
  ...extra,
});

describe('triageGroup', () => {
  it('puts a read rating at the threshold in "worth a look", an estimate at most in "check"', () => {
    expect(triageGroup(lead(1, { score: 70, basis: 'read' }))).toBe('worth');
    expect(triageGroup(lead(2, { score: 95, basis: 'estimated' }))).toBe('check');
    expect(triageGroup(lead(3, { score: 70 }))).toBe('worth');
  });

  it('checks the middle band and an estimate from 50, and drops low, unscored or excluded leads', () => {
    expect(triageGroup(lead(1, { score: 69, basis: 'read' }))).toBe('check');
    expect(triageGroup(lead(2, { score: 50, basis: 'estimated' }))).toBe('check');
    expect(triageGroup(lead(3, { score: 49, basis: 'read' }))).toBe('unlikely');
    expect(triageGroup(lead(4, { score: null }))).toBe('unlikely');
    expect(triageGroup(lead(5, { score: 90, basis: 'read', exclusion: 'Freelance' }))).toBe('unlikely');
  });
});

describe('groupLeads', () => {
  it('sorts each group by score, best first', () => {
    const groups = groupLeads([
      lead(1, { score: 55 }),
      lead(2, { score: 80 }),
      lead(3, { score: 65 }),
      lead(4, { score: 10 }),
    ]);
    expect(groups.worth.map((l) => l.id)).toEqual([2]);
    expect(groups.check.map((l) => l.id)).toEqual([3, 1]);
    expect(groups.unlikely.map((l) => l.id)).toEqual([4]);
  });
});
