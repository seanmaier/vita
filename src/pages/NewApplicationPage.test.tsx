import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes, useParams } from 'react-router-dom';
import { beforeEach, describe, expect, it } from 'vitest';
import { hydrate, setStorageBackend } from '../utils/storage';
import { getAllLocalApplications } from '../utils/localApplications';
import { NewApplicationPage } from './NewApplicationPage';

function Opened() {
  return <p>opened {useParams().id}</p>;
}

/** Opens the page and takes the English default profile on its first step. */
async function renderPage() {
  render(
    <MemoryRouter initialEntries={['/application/new']}>
      <Routes>
        <Route path="/application/new" element={<NewApplicationPage />} />
        <Route path="/application/:id" element={<Opened />} />
      </Routes>
    </MemoryRouter>,
  );
  await userEvent.click(screen.getByRole('button', { name: /English \(default\)$/ }));
}

describe('NewApplicationPage', () => {
  beforeEach(() => {
    // An empty account whose writes stay in memory instead of going to the server.
    setStorageBackend(async () => {});
    hydrate({});
  });

  it('saves a draft named after the company and opens it', async () => {
    await renderPage();
    const save = screen.getByRole('button', { name: 'Save application' });
    expect(save).toBeDisabled();

    fireEvent.change(screen.getByPlaceholderText('e.g. Vattenfall'), { target: { value: 'Kaiwerk Studio' } });
    fireEvent.change(screen.getByPlaceholderText('e.g. Backend Engineer'), {
      target: { value: 'Fullstack Developer' },
    });
    expect(screen.getByText(/"id": "kaiwerk-studio"/)).toBeInTheDocument();

    await userEvent.click(save);
    expect(screen.getByText('opened kaiwerk-studio')).toBeInTheDocument();
    expect(getAllLocalApplications()).toMatchObject([
      { id: 'kaiwerk-studio', company: 'Kaiwerk Studio', role: 'Fullstack Developer', status: 'drafting' },
    ]);
  });

  it('adds a cover letter addressed to the company', async () => {
    await renderPage();
    fireEvent.change(screen.getByPlaceholderText('e.g. Vattenfall'), { target: { value: 'Acme' } });
    await userEvent.click(screen.getByRole('checkbox', { name: 'Include cover letter' }));
    fireEvent.change(screen.getByPlaceholderText('Paragraph 1'), { target: { value: 'Hello there' } });
    await userEvent.click(screen.getByRole('button', { name: '+ Add paragraph' }));
    expect(screen.getByPlaceholderText('Paragraph 2')).toBeInTheDocument();
    expect(screen.getByText(/"recipientOrg": "Acme"/)).toBeInTheDocument();
    expect(screen.getByText(/"Hello there"/)).toBeInTheDocument();
  });
});
