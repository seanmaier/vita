import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { fetchLeads, updateLead } from '../utils/api';
import type { JobLead, JobLeadStatus } from '../types';

type Filter = Extract<JobLeadStatus, 'rated' | 'new' | 'dismissed'>;

const FILTERS: { status: Filter; label: string }[] = [
  { status: 'rated', label: 'Rated' },
  { status: 'new', label: 'New' },
  { status: 'dismissed', label: 'Dismissed' },
];

const tabClass = (active: boolean) =>
  `[font-family:var(--font-mono)] text-[11px] bg-transparent border-0 border-b-2 px-3 py-2 cursor-pointer ${
    active
      ? 'border-[color:var(--accent)] text-[color:var(--accent)]'
      : 'border-transparent text-[color:var(--ink-3)] hover:text-[color:var(--ink-invert)]'
  }`;

const actionButton =
  '[font-family:var(--font-mono)] text-[11px] bg-transparent border border-[color:var(--rule)] text-[color:var(--ink-2)] rounded px-3 py-1.5 cursor-pointer transition-colors duration-150 hover:text-[color:var(--ink-invert)] hover:border-[color:var(--ink-2)]';

/** Best score first; leads without a score last. */
function byScoreDesc(a: JobLead, b: JobLead): number {
  return (b.score ?? -1) - (a.score ?? -1);
}

/** Server order: newest first. */
function byNewest(a: JobLead, b: JobLead): number {
  return b.receivedAt.localeCompare(a.receivedAt);
}

function scoreClass(score: number): string {
  if (score >= 75) return 'text-[color:var(--status-offer)] border-[color:var(--status-offer)]';
  if (score >= 50) return 'text-[color:var(--ink-2)] border-[color:var(--ink-2)]';
  return 'text-[color:var(--ink-3)] border-[color:var(--rule)]';
}

function LeadCard({ lead, onSet }: { lead: JobLead; onSet: (status: 'dismissed' | 'applied') => void }) {
  const meta = [lead.company, lead.location, lead.source].filter(Boolean).join(' · ');
  return (
    <li className="bg-[color:var(--surface)] border border-[color:var(--rule)] rounded-[5px] p-4 flex flex-col gap-2.5">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-[14px] font-semibold text-[color:var(--ink-invert)] break-words m-0">{lead.title}</h2>
          <p className="[font-family:var(--font-mono)] text-[11px] text-[color:var(--ink-3)] break-words m-0 mt-1">{meta}</p>
        </div>
        {lead.score !== null && (
          <span
            className={`[font-family:var(--font-mono)] text-[12px] font-semibold border rounded px-2 py-0.5 shrink-0 ${scoreClass(lead.score)}`}
            title="Match score"
          >
            {lead.score}%
          </span>
        )}
      </div>
      {lead.verdict && <p className="text-[12.5px] leading-[1.55] text-[color:var(--ink-2)] m-0">{lead.verdict}</p>}
      <div className="flex flex-wrap items-center gap-2">
        <a
          className="[font-family:var(--font-mono)] text-[11px] text-[color:var(--accent)] no-underline hover:underline mr-2"
          href={lead.url}
          target="_blank"
          rel="noopener noreferrer"
        >
          Open posting ↗
        </a>
        {lead.status !== 'dismissed' && (
          <button className={actionButton} type="button" onClick={() => onSet('dismissed')}>Dismiss</button>
        )}
        <button className={actionButton} type="button" onClick={() => onSet('applied')}>Mark as applied</button>
      </div>
    </li>
  );
}

export function LeadsPage() {
  const [filter, setFilter] = useState<Filter>('rated');
  // null while loading.
  const [leads, setLeads] = useState<JobLead[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  // The tab currently shown, so a late failure can tell whether it still applies.
  const filterRef = useRef(filter);
  filterRef.current = filter;

  useEffect(() => {
    let cancelled = false;
    setLeads(null);
    setLoadError(null);
    setActionError(null);
    fetchLeads(filter)
      .then((list) => {
        if (!cancelled) setLeads(filter === 'rated' ? [...list].sort(byScoreDesc) : list);
      })
      .catch((e) => {
        if (!cancelled) setLoadError(e instanceof Error ? e.message : 'Loading the job leads failed.');
      });
    return () => {
      cancelled = true;
    };
  }, [filter]);

  // Removes the lead right away and puts it back if the server refuses.
  const setStatus = async (lead: JobLead, status: 'dismissed' | 'applied') => {
    const from = filter;
    setActionError(null);
    setLeads((cur) => cur && cur.filter((l) => l.id !== lead.id));
    try {
      await updateLead(lead.id, { status });
    } catch (e) {
      // The tab changed meanwhile: its list is reloaded anyway, and this lead doesn't belong in it.
      if (filterRef.current !== from) return;
      setActionError(e instanceof Error ? e.message : 'Updating the job lead failed.');
      setLeads((cur) => {
        if (!cur || cur.some((l) => l.id === lead.id)) return cur;
        return [...cur, lead].sort(from === 'rated' ? byScoreDesc : byNewest);
      });
    }
  };

  return (
    <div className="min-h-screen bg-[color:var(--bg)] pt-6 px-4 pb-32 max-w-[900px] mx-auto sm:pt-12 sm:px-8">
      <header className="mb-6 sm:mb-8 [font-family:var(--font-mono)] text-[15px] flex flex-wrap items-center gap-x-5 gap-y-1">
        <Link className="text-[11px] text-[color:var(--ink-3)] no-underline hover:text-[color:var(--ink-invert)]" to="/">
          ← Applications
        </Link>
        <span>
          <span className="text-[color:var(--ink-3)]">~/</span>
          <span className="text-[color:var(--accent)]">leads</span>
          <span className="text-[color:var(--ink-3)] animate-pulse"> _</span>
        </span>
      </header>

      <div className="flex border-b border-[color:var(--rule)] mb-5" role="tablist">
        {FILTERS.map((f) => (
          <button
            key={f.status}
            className={tabClass(f.status === filter)}
            type="button"
            role="tab"
            aria-selected={f.status === filter}
            onClick={() => setFilter(f.status)}
          >
            {f.label}
          </button>
        ))}
      </div>

      {actionError && <p className="text-[12px] text-[color:var(--status-rejected)] mb-3">{actionError}</p>}

      {loadError ? (
        <p className="text-[12px] text-[color:var(--status-rejected)]">{loadError}</p>
      ) : leads === null ? (
        <p className="[font-family:var(--font-mono)] text-[12px] text-[color:var(--ink-3)]">loading…</p>
      ) : leads.length === 0 ? (
        <p className="[font-family:var(--font-mono)] text-[12px] text-[color:var(--ink-3)]">no job leads here.</p>
      ) : (
        <ul className="list-none p-0 m-0 flex flex-col gap-3">
          {leads.map((lead) => (
            <LeadCard key={lead.id} lead={lead} onSet={(status) => void setStatus(lead, status)} />
          ))}
        </ul>
      )}
    </div>
  );
}
