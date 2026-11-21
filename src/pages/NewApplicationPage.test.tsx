import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes, useParams } from 'react-router-dom';
import { beforeEach, describe, expect, it } from 'vitest';
import { hydrate, setStorageBackend, storage } from '../utils/storage';
import { NewApplicationPage } from './NewApplicationPage';
import { withData } from '../test/withData';
import { getStaticProfile } from '../data/profiles';

function Opened() {
  return <p>opened {useParams().id}</p>;
}

/** Opens the page and takes the English default profile on its first step. */
async function renderPage() {
  render(
    withData(
      <MemoryRouter initialEntries={['/application/new']}>
        <Routes>
          <Route path="/application/new" element={<NewApplicationPage />} />
          <Route path="/application/:id" element={<Opened />} />
        </Routes>
      </MemoryRouter>,
    ),
  );
  // The base profiles load first (and are seeded on a fresh account).
  await userEvent.click(await screen.findByRole('button', { name: /English \(default\)$/ }));
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
    expect(await screen.findByText('opened kaiwerk-studio')).toBeInTheDocument();
    expect(JSON.parse(storage.getItem('local-apps') ?? '[]')).toMatchObject([
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

  it("seeds the language default from the user's old edit to it", async () => {
    const edited = {
      ...getStaticProfile('en'),
      projects: [{ id: 'mine', name: 'My own project', stack: '', description: '' }],
    };
    hydrate({ 'profile-override-en': JSON.stringify(edited) });
    await renderPage();
    expect(screen.getByText('My own project')).toBeInTheDocument();
  });
});
