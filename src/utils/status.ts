import type { ApplicationStatus } from '../types';

export const STATUS_LABELS: Record<ApplicationStatus, string> = {
  drafting:  'drafting',
  ready:     'ready',
  sent:      'sent',
  interview: 'interview',
  offer:     'offer',
  rejected:  'rejected',
  ghosted:   'ghosted',
  withdrawn: 'withdrawn',
  accepted:  'accepted',
  declined:  'declined',
  evaluated: 'evaluated',
  skipped:   'skipped',
};

export const STATUS_COLORS: Record<ApplicationStatus, string> = {
  drafting:  'var(--status-drafting)',
  ready:     'var(--status-ready)',
  sent:      'var(--status-sent)',
  interview: 'var(--status-interview)',
  offer:     'var(--status-offer)',
  rejected:  'var(--status-rejected)',
  ghosted:   'var(--status-ghosted)',
  withdrawn: 'var(--status-withdrawn)',
  accepted:  'var(--status-accepted)',
  declined:  'var(--status-declined)',
  evaluated: 'var(--status-evaluated)',
  skipped:   'var(--status-skipped)',
};
