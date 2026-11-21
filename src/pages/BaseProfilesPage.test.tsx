import { fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes, useParams } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { hydrate, setStorageBackend } from '../utils/storage';
import { withData } from '../test/withData';
import { BaseProfilesPage } from './BaseProfilesPage';
import { TrashPage } from './TrashPage';

function Opened() {
  return <p>editing {useParams().id}</p>;
}

function renderAt(path: string) {
  render(
    withData(
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path="/profiles" element={<BaseProfilesPage />} />
          <Route path="/profiles/:id" element={<Opened />} />
          <Route path="/trash" element={<TrashPage />} />
        </Routes>
      </MemoryRouter>,
    ),
  );
}

const row = (name: string) => screen.getByText(name).closest('div.group') as HTMLElement;

describe('base profiles', () => {
  beforeEach(() => {
    setStorageBackend(async () => {});
    hydrate({});
    vi.spyOn(window, 'confirm').mockReturnValue(true);
  });

  it('seeds one profile per language the first time', async () => {
    renderAt('/profiles');
    expect(await screen.findByText('English (default)')).toBeInTheDocument();
    expect(screen.getByText('Deutsch (default)')).toBeInTheDocument();
    expect(screen.getByText('Svenska (default)')).toBeInTheDocument();
  });

  it('creates a profile and opens it', async () => {
    renderAt('/profiles');
    await userEvent.click(await screen.findByRole('button', { name: '+ new base profile' }));
    fireEvent.change(screen.getByPlaceholderText('e.g. Backend (EN)'), { target: { value: 'Backend DE' } });
    await userEvent.click(screen.getByRole('button', { name: 'Create' }));
    expect(await screen.findByText('editing backend-de')).toBeInTheDocument();
  });

  it('moves a profile to the trash, where it can be restored', async () => {
    renderAt('/profiles');
    await screen.findByText('Svenska (default)');
    await userEvent.click(within(row('Svenska (default)')).getByRole('button', { name: 'delete' }));
    expect(screen.queryByText('Svenska (default)')).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'trash (1)' })).toBeInTheDocument();

    await userEvent.click(screen.getByRole('link', { name: 'trash (1)' }));
    expect(await screen.findByText(/Svenska \(default\)/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'restore' }));
    expect(screen.queryByText(/Svenska \(default\)/)).not.toBeInTheDocument();
  });

  it('deletes a trashed profile for good', async () => {
    renderAt('/profiles');
    await screen.findByText('Deutsch (default)');
    await userEvent.click(within(row('Deutsch (default)')).getByRole('button', { name: 'delete' }));
    await userEvent.click(screen.getByRole('link', { name: 'trash (1)' }));
    await screen.findByText(/Deutsch \(default\)/);
    await userEvent.click(screen.getByRole('button', { name: /delete permanently/i }));
    expect(screen.queryByText(/Deutsch \(default\)/)).not.toBeInTheDocument();
  });
});
