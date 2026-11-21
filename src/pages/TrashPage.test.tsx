import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { hydrate, setStorageBackend, storage } from '../utils/storage';
import { withData } from '../test/withData';
import { TrashPage } from './TrashPage';

const trashed = {
  id: 'acme',
  company: 'Acme',
  role: 'Developer',
  status: 'drafting',
  language: 'en',
  deletedAt: '2026-11-18T10:00:00.000Z',
};

const listed = () => JSON.parse(storage.getItem('local-apps') ?? '[]') as { id: string; deletedAt?: string }[];

async function renderPage() {
  render(
    withData(
      <MemoryRouter>
        <TrashPage />
      </MemoryRouter>,
    ),
  );
  // Shown with its saved edits, as everywhere else.
  return within((await screen.findByText(/Acme – Dev$/)).closest('div.border-b') as HTMLElement);
}

describe('TrashPage', () => {
  beforeEach(() => {
    setStorageBackend(async () => {});
    hydrate({
      'local-apps': JSON.stringify([trashed]),
      'app-config-acme': JSON.stringify({ ...trashed, role: 'Dev' }),
    });
  });

  it('restores a trashed application', async () => {
    const row = await renderPage();
    await userEvent.click(row.getByRole('button', { name: 'restore' }));
    await vi.waitFor(() => expect(listed()[0]).not.toHaveProperty('deletedAt'));
    await vi.waitFor(() => expect(screen.queryByText(/Acme – Dev$/)).toBeNull());
  });

  it('deletes an application for good with its saved edits once confirmed', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    const row = await renderPage();
    await userEvent.click(row.getByRole('button', { name: 'delete permanently' }));
    await vi.waitFor(() => expect(listed()).toEqual([]));
    expect(storage.getItem('app-config-acme')).toBeNull();
  });
});
