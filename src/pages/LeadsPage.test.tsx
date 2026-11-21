import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { JobLead, JobLeadStatus } from '#shared/types.ts';
import { LeadsPage } from './LeadsPage';

// An in-memory server for the two calls the page makes.
let store: JobLead[] = [];
const updateLead = vi.fn(async (id: number, patch: { status?: JobLeadStatus }) => {
  const lead = store.find((l) => l.id === id)!;
  Object.assign(lead, patch);
  return { ...lead };
});
vi.mock('../utils/api', () => ({
  fetchLeads: async (status?: JobLeadStatus) =>
    store.filter((l) => !status || l.status === status).map((l) => ({ ...l })),
  updateLead: (id: number, patch: { status?: JobLeadStatus }) => updateLead(id, patch),
}));

const lead = (id: number, title: string, extra: Partial<JobLead> = {}): JobLead => ({
  id,
  source: 'indeed',
  externalId: `e${id}`,
  title,
  url: `https://example.com/${id}`,
  receivedAt: `2026-11-19 05:0${id}:00`,
  status: 'rated',
  score: 60,
  verdict: null,
  ratedAt: '2026-11-19 05:10:00',
  applicationId: null,
  ...extra,
});

function renderPage() {
  render(
    <MemoryRouter>
      <LeadsPage />
    </MemoryRouter>,
  );
}

const section = (name: string) => within(screen.getByRole('region', { name }));

describe('LeadsPage', () => {
  beforeEach(() => {
    updateLead.mockClear();
    store = [
      lead(1, 'Backend Developer C#', { score: 82, basis: 'read', verdict: 'Passt gut' }),
      lead(2, 'Go Backend Junior', { score: 75, basis: 'estimated', verdict: 'Anzeige nicht lesbar; Go, Hamburg' }),
      lead(3, 'ABAP Entwickler', { score: 10, basis: 'estimated', exclusion: 'Direkte Arbeit mit SAP' }),
      lead(4, 'PHP Developer', { score: 30, basis: 'read' }),
      lead(5, 'Fresh lead', { status: 'new', score: null }),
    ];
  });

  it('groups the leads to decide and marks an estimated score', async () => {
    renderPage();
    expect(await screen.findByText('Backend Developer C#')).toBeInTheDocument();
    expect(section('Worth a look').getByText('Backend Developer C#')).toBeInTheDocument();
    // An estimate never counts as worth a look, however high.
    expect(section('Check').getByText('Go Backend Junior')).toBeInTheDocument();
    expect(section('Check').getByText('~75%')).toBeInTheDocument();
    expect(section('Unlikely').getByText('Excluded: Direkte Arbeit mit SAP')).toBeInTheDocument();
    expect(await screen.findByText('4 to decide · 1 unrated · 2 of them estimated')).toBeInTheDocument();
  });

  it('dismisses a lead and brings it back with undo', async () => {
    renderPage();
    await userEvent.click(await screen.findByRole('button', { name: 'Dismiss: Backend Developer C#' }));
    expect(screen.queryByText('Backend Developer C#')).not.toBeInTheDocument();
    expect(updateLead).toHaveBeenLastCalledWith(1, { status: 'dismissed' });
    await userEvent.click(screen.getByRole('button', { name: 'Undo' }));
    expect(await screen.findByText('Backend Developer C#')).toBeInTheDocument();
    expect(updateLead).toHaveBeenLastCalledWith(1, { status: 'rated' });
  });

  it('dismisses all unlikely leads in one step', async () => {
    renderPage();
    await userEvent.click(await screen.findByRole('button', { name: 'Dismiss all 2' }));
    expect(screen.queryByRole('region', { name: 'Unlikely' })).not.toBeInTheDocument();
    expect(store.filter((l) => l.status === 'dismissed').map((l) => l.id)).toEqual([3, 4]);
    expect(screen.getByRole('status')).toHaveTextContent('Dismissed 2 unlikely leads');
  });

  it('restores a dismissed lead to the leads to decide', async () => {
    store[0].status = 'dismissed';
    renderPage();
    await userEvent.click(await screen.findByRole('tab', { name: 'Dismissed' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Restore: Backend Developer C#' }));
    expect(store[0].status).toBe('rated');
    expect(screen.queryByText('Backend Developer C#')).not.toBeInTheDocument();
  });
});
