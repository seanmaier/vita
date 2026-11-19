import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { JobFit } from '#shared/types.ts';
import { FitBadge } from './FitBadge';

const fit: JobFit = {
  score: 72,
  recommendation: 'apply',
  reason: 'Strong match on React and TypeScript.',
  evaluatedAt: '2026-11-16T10:00:00.000Z',
};

describe('FitBadge', () => {
  it('shows a dash when the job has not been checked', () => {
    render(<FitBadge />);
    expect(screen.getByText('—')).toBeInTheDocument();
  });

  it('shows the score with the recommendation and reason on hover', () => {
    render(<FitBadge fit={fit} />);
    const badge = screen.getByText('72 %');
    expect(badge).toHaveAttribute('title', 'apply: Strong match on React and TypeScript.');
  });

  it('shows the capped score and says what it was capped from', () => {
    render(<FitBadge fit={{ ...fit, cappedScore: 50, recommendation: 'apply-if' }} />);
    expect(screen.getByText('50 %')).toHaveAttribute('title', expect.stringContaining('apply if … (capped from 72 %)'));
  });

  it('adds the per-criterion breakdown to the hover text', () => {
    const criteria = [
      { name: 'Stack', weight: 60, fulfilled: 100 },
      { name: 'Location', weight: 40, fulfilled: 50 },
    ];
    render(<FitBadge fit={{ ...fit, criteria }} />);
    expect(screen.getByText('72 %')).toHaveAttribute('title', expect.stringContaining('Location: 50 % × 40 = 20'));
  });
});
