import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter, RouterProvider, useParams } from 'react-router-dom';
import { beforeEach, describe, expect, it } from 'vitest';
import { hydrate, setStorageBackend } from '../utils/storage';
import { getConfigOverride } from '../utils/appStorage';
import { EditApplicationPage } from './EditApplicationPage';

const stored = {
  id: 'acme',
  company: 'Acme',
  role: 'Developer',
  status: 'drafting',
  language: 'en',
  appliedDate: '2026-11-01',
};

function renderEditor() {
  // A data router, since the page blocks leaving with unsaved edits.
  const router = createMemoryRouter(
    [
      { path: '/application/:id/edit', element: <EditApplicationPage /> },
      { path: '/application/:id', element: <Opened /> },
      { path: '/', element: <p>dashboard</p> },
    ],
    { initialEntries: ['/application/acme/edit'] },
  );
  render(<RouterProvider router={router} />);
}

function Opened() {
  return <p>opened {useParams().id}</p>;
}

describe('EditApplicationPage', () => {
  beforeEach(() => {
    setStorageBackend(async () => {});
    hydrate({ 'local-apps': JSON.stringify([stored]) });
  });

  it('saves the edited role as the application’s saved edits and opens it', async () => {
    renderEditor();
    fireEvent.change(screen.getByDisplayValue('Developer'), { target: { value: 'Senior Developer' } });
    // The header's button; the change bar under the form has one too.
    await userEvent.click(screen.getAllByRole('button', { name: 'Save changes' })[0]);
    expect(screen.getByText('opened acme')).toBeInTheDocument();
    // The date it doesn't edit is carried along untouched.
    expect(getConfigOverride('acme')).toMatchObject({ role: 'Senior Developer', appliedDate: '2026-11-01' });
  });

  it('asks before leaving with unsaved edits, and stays on "Cancel"', async () => {
    renderEditor();
    fireEvent.change(screen.getByDisplayValue('Acme'), { target: { value: 'Acme GmbH' } });
    await userEvent.click(screen.getByRole('link', { name: '← Acme' }));
    expect(screen.getByText('Unsaved changes')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.getByDisplayValue('Acme GmbH')).toBeInTheDocument();
    expect(getConfigOverride('acme')).toBeNull();
  });

  it('shows the cover letter fields once it is switched on', async () => {
    renderEditor();
    await userEvent.click(screen.getByRole('checkbox', { name: 'Include cover letter' }));
    expect(screen.getByPlaceholderText('defaults to Hiring Team')).toBeInTheDocument();
    expect(screen.getByPlaceholderText('Paragraph 1')).toBeInTheDocument();
  });
});
