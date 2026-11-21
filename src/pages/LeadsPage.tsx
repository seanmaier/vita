import { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { fetchLeads, updateLead } from '../utils/api';
import type { JobLead, JobLeadStatus } from '#shared/types.ts';
import { LeadListSkeleton } from '../components/Skeleton';
import { actionButton, LeadRow, type LeadAction } from '../components/leads/LeadRow';
import { UndoBar } from '../components/leads/UndoBar';
import { byScoreDesc, groupLeads, TRIAGE_GROUPS, type TriageGroup } from '../utils/leadTriage';

type Filter = Extract<JobLeadStatus, 'rated' | 'new' | 'dismissed'>;

const FILTERS: { status: Filter; label: string }[] = [
  { status: 'rated', label: 'To decide' },
  { status: 'new', label: 'Unrated' },
  { status: 'dismissed', label: 'Dismissed' },
];

const OPEN_ACTIONS: LeadAction[] = [
  { label: 'Dismiss', status: 'dismissed' },
  { label: 'Mark as applied', status: 'applied' },
];

/** A dismissed lead goes back to where it came from: rated if it has a score, else unrated. */
const restoreAction = (lead: JobLead): LeadAction[] => [
  { label: 'Restore', status: lead.score === null ? 'new' : 'rated' },
];

const tabClass = (active: boolean) =>
  `font-mono text-[11px] bg-transparent border-0 border-b-2 px-3 py-2 cursor-pointer ${
    active ? 'border-accent text-accent' : 'border-transparent text-ink-3 hover:text-ink-invert'
  }`;

const VERB: Partial<Record<JobLeadStatus, string>> = { dismissed: 'Dismissed', applied: 'Marked as applied' };

interface Counts {
  rated: number;
  new: number;
  estimated: number;
}

/** A change the user can still take back: the leads as they were before it. */
interface Undoable {
  message: string;
  before: JobLead[];
  /** The change itself, so an undo never overtakes it. */
  saving: Promise<unknown>;
}

function sortFor(filter: Filter, leads: JobLead[]): JobLead[] {
  return filter === 'rated'
    ? [...leads].sort(byScoreDesc)
    : [...leads].sort((a, b) => b.receivedAt.localeCompare(a.receivedAt));
}

const message = (e: unknown, fallback: string) => (e instanceof Error ? e.message : fallback);

function Summary({ counts }: { counts: Counts | null }) {
  if (!counts) return null;
  const parts = [`${counts.rated} to decide`, `${counts.new} unrated`];
  if (counts.estimated) parts.push(`${counts.estimated} of them estimated`);
  return <p className="font-mono text-[11px] text-ink-3 m-0 mb-4">{parts.join(' · ')}</p>;
}

function GroupSection({
  group,
  leads,
  onlyGroup,
  onAction,
  onDismissAll,
}: {
  group: (typeof TRIAGE_GROUPS)[number];
  leads: JobLead[];
  onlyGroup: boolean;
  onAction: (lead: JobLead, status: JobLeadStatus) => void;
  onDismissAll: () => void;
}) {
  const heading = (
    <span className="font-mono text-[12px] text-ink-invert">
      {group.label} <span className="text-ink-3">({leads.length})</span>
      <span className="text-ink-3 text-[11px] ml-2">{group.hint}</span>
    </span>
  );
  const list = (
    <ul className="list-none p-0 m-0 mt-2 flex flex-col gap-2">
      {leads.map((lead) => (
        <LeadRow key={lead.id} lead={lead} actions={OPEN_ACTIONS} onAction={(status) => onAction(lead, status)} />
      ))}
    </ul>
  );
  if (group.group !== 'unlikely') {
    return (
      <section aria-label={group.label}>
        <h2 className="m-0">{heading}</h2>
        {list}
      </section>
    );
  }
  // Unlikely leads stay folded unless they are all there is, and can go in one step.
  return (
    <section aria-label={group.label}>
      <details open={onlyGroup}>
        <summary className="cursor-pointer select-none text-ink-3">{heading}</summary>
        <div className="mt-2">
          <button className={actionButton} type="button" onClick={onDismissAll}>
            Dismiss all {leads.length}
          </button>
        </div>
        {list}
      </details>
    </section>
  );
}

export function LeadsPage() {
  const [filter, setFilter] = useState<Filter>('rated');
  // null while loading.
  const [leads, setLeads] = useState<JobLead[] | null>(null);
  const [counts, setCounts] = useState<Counts | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [undoable, setUndoable] = useState<Undoable | null>(null);
  // The tab currently shown, so a late result can tell whether it still applies.
  const filterRef = useRef(filter);
  filterRef.current = filter;

  const refreshCounts = useCallback(() => {
    Promise.all([fetchLeads('rated'), fetchLeads('new')])
      .then(([rated, unrated]) =>
        setCounts({
          rated: rated.length,
          new: unrated.length,
          estimated: rated.filter((l) => l.basis === 'estimated').length,
        }),
      )
      .catch(() => setCounts(null));
  }, []);

  useEffect(refreshCounts, [refreshCounts]);

  useEffect(() => {
    let cancelled = false;
    setLeads(null);
    setLoadError(null);
    setActionError(null);
    fetchLeads(filter)
      .then((list) => {
        if (!cancelled) setLeads(sortFor(filter, list));
      })
      .catch((e) => {
        if (!cancelled) setLoadError(message(e, 'Loading the job leads failed.'));
      });
    return () => {
      cancelled = true;
    };
  }, [filter]);

  /** Puts leads back into the list shown, if they belong to the tab that is still open. */
  const putBack = (from: Filter, back: JobLead[]) => {
    if (filterRef.current !== from) return;
    setLeads((cur) => cur && sortFor(from, [...cur.filter((l) => !back.some((b) => b.id === l.id)), ...back]));
  };

  // Takes the leads out right away and puts back those the server refuses.
  const move = async (moved: JobLead[], status: JobLeadStatus, what: string) => {
    const from = filter;
    setActionError(null);
    setLeads((cur) => cur && cur.filter((l) => !moved.some((m) => m.id === l.id)));
    const saving = Promise.allSettled(moved.map((l) => updateLead(l.id, { status })));
    setUndoable({ message: what, before: moved, saving });
    const results = await saving;
    const failed = moved.filter((_, i) => results[i].status === 'rejected');
    if (failed.length) {
      const reason = results.find((r) => r.status === 'rejected') as PromiseRejectedResult;
      setActionError(message(reason.reason, 'Updating the job lead failed.'));
      setUndoable(null);
      putBack(from, failed);
    }
    refreshCounts();
  };

  const undo = async () => {
    if (!undoable) return;
    const { before, saving } = undoable;
    setUndoable(null);
    setActionError(null);
    const from = filter;
    try {
      await saving;
      await Promise.all(before.map((l) => updateLead(l.id, { status: l.status })));
      putBack(
        from,
        before.filter((l) => l.status === from),
      );
    } catch (e) {
      setActionError(message(e, 'Undoing failed.'));
    }
    refreshCounts();
  };

  const onAction = (lead: JobLead, status: JobLeadStatus) =>
    void move([lead], status, `${VERB[status] ?? 'Restored'}: ${lead.title}`);

  const hideUndo = useCallback(() => setUndoable(null), []);

  const groups = leads && filter === 'rated' ? groupLeads(leads) : null;
  const filled = groups ? TRIAGE_GROUPS.filter((g) => groups[g.group].length) : [];

  return (
    <div className="min-h-screen bg-bg pt-6 px-4 pb-32 max-w-[900px] mx-auto sm:pt-12 sm:px-8">
      <header className="mb-6 sm:mb-8 font-mono text-[15px] flex flex-wrap items-center gap-x-5 gap-y-1">
        <Link className="text-[11px] text-ink-3 no-underline hover:text-ink-invert" to="/">
          ← Applications
        </Link>
        <span>
          <span className="text-ink-3">~/</span>
          <span className="text-accent">leads</span>
          <span className="text-ink-3 animate-pulse"> _</span>
        </span>
      </header>

      <Summary counts={counts} />

      <div className="flex border-b border-rule mb-5" role="tablist">
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

      {actionError && <p className="text-[12px] text-status-rejected mb-3">{actionError}</p>}

      {loadError ? (
        <p className="text-[12px] text-status-rejected">{loadError}</p>
      ) : leads === null ? (
        <LeadListSkeleton />
      ) : leads.length === 0 ? (
        <p className="font-mono text-[12px] text-ink-3">
          {filter === 'rated' ? 'nothing left to decide.' : 'no job leads here.'}
        </p>
      ) : groups ? (
        <div className="flex flex-col gap-6">
          {filled.map((g) => (
            <GroupSection
              key={g.group}
              group={g}
              leads={groups[g.group as TriageGroup]}
              onlyGroup={filled.length === 1}
              onAction={onAction}
              onDismissAll={() =>
                void move(groups.unlikely, 'dismissed', `Dismissed ${groups.unlikely.length} unlikely leads`)
              }
            />
          ))}
        </div>
      ) : (
        <ul className="list-none p-0 m-0 flex flex-col gap-2">
          {leads.map((lead) => (
            <LeadRow
              key={lead.id}
              lead={lead}
              actions={filter === 'dismissed' ? restoreAction(lead) : OPEN_ACTIONS}
              onAction={(status) => onAction(lead, status)}
            />
          ))}
        </ul>
      )}

      {undoable && <UndoBar message={undoable.message} onUndo={() => void undo()} onDone={hideUndo} />}
    </div>
  );
}
