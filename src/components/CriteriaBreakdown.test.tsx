import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { CriteriaBreakdown } from './CriteriaBreakdown';

describe('CriteriaBreakdown', () => {
  it('renders nothing without criteria', () => {
    const { container } = render(<CriteriaBreakdown criteria={[]} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('lists each criterion with the points it adds', () => {
    render(
      <CriteriaBreakdown
        criteria={[
          { name: 'Stack', weight: 60, fulfilled: 100 },
          { name: 'Location', weight: 40, fulfilled: 25 },
        ]}
      />,
    );
    const location = screen.getByRole('row', { name: /Location/ });
    expect(within(location).getAllByRole('cell').map((c) => c.textContent)).toEqual(['Location', '40', '25 %', '10']);
  });

  it('names the exclusion criterion that applied', () => {
    render(<CriteriaBreakdown criteria={[{ name: 'Stack', weight: 100, fulfilled: 0 }]} exclusion="On-site only" />);
    expect(screen.getByText('Excluded: On-site only')).toBeInTheDocument();
  });
});
