import { useState } from 'react';
import { applications as staticApps } from '../data/applications';
import { useTrashCount } from '../utils/trashCount';
import { TRASH_RETENTION_DAYS } from '#shared/utils/trash.ts';
import { STATUS_LABELS } from '../utils/status';
import { statusOf, type StatusAction } from '../utils/statusTransitions';
import { useApplicationMutations, useApplications, type AppRecord } from '../api/applications';
import { QueryState } from '../components/QueryState';
import { derivedDates } from '#shared/domain/statusMachine.ts';
import { ApplicationCard } from '../components/dashboard/ApplicationCard';
import { fitScore } from '#shared/utils/fitCriteria.ts';
import { ImportApplicationModal } from '../components/ImportApplicationModal';
import { BackupModal } from '../components/BackupModal';
import { DashboardNav } from '../components/dashboard/DashboardNav';
import { StatsBar } from '../components/dashboard/StatsBar';
import { numericDateToIso } from '#shared/utils/date.ts';
import { matchesStat, type StatKey } from '../utils/applicationStats';
import { useRatedLeadCount } from '../hooks/useRatedLeadCount';
import { createNote } from '#shared/utils/notes.ts';
import { LANGUAGE_LABELS, languageOf } from '#shared/utils/language.ts';
import type { AppLanguage, ApplicationConfig, ApplicationStatus, Note } from '#shared/types.ts';

type SortField =
  'company' | 'role' | 'language' | 'fit' | 'status' | 'appliedDate' | 'interviewDate' | 'finalDecisionDate';

const SORT_LABELS: Record<SortField, string> = {
  company: 'company',
  role: 'role',
  language: 'language',
  fit: 'fit',
  status: 'status',
  appliedDate: 'applied',
  interviewDate: 'interview',
  finalDecisionDate: 'decision',
};

export function DashboardPage() {
  return <QueryState query={useApplications()}>{(records) => <DashboardContent records={records} />}</QueryState>;
}

function DashboardContent({ records }: { records: AppRecord[] }) {
  const { changeStatus, saveEdits, trash } = useApplicationMutations();
  const showError = (e: Error) => alert(e.message);
  const live = records.filter((r) => !r.app.deletedAt);
  const allApps = live.map((r) => r.app);
  const recordOf = new Map(live.map((r) => [r.app.id, r]));

  // Status and the applied/interview/decision dates follow each application's
  // status history; notes and the language come from its saved edits, if any.
  const historyFor = (app: ApplicationConfig) => recordOf.get(app.id)!.history;
  const notesOf = (id: string): Note[] | undefined => {
    const record = recordOf.get(id);
    return record?.savedEdits?.notes ?? record?.app.notes;
  };
  const languageFor = (app: ApplicationConfig) =>
    languageOf({ language: recordOf.get(app.id)?.savedEdits?.language ?? app.language });

  const ratedLeadCount = useRatedLeadCount();
  const [importOpen, setImportOpen] = useState(false);
  const [backupOpen, setBackupOpen] = useState(false);

  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<ApplicationStatus | ''>('');
  const [languageFilter, setLanguageFilter] = useState<AppLanguage | ''>('');
  const [sortField, setSortField] = useState<SortField | null>(null);
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc');
  const [statFilter, setStatFilter] = useState<StatKey | null>(null);
  const handleStatSelect = (key: StatKey) => {
    setStatFilter((prev) => (prev === key || key === 'total' ? null : key));
  };

  const handleStatusChange = (app: ApplicationConfig, action: StatusAction) =>
    changeStatus.mutate({ id: app.id, history: historyFor(app), action }, { onError: showError });

  // Notes are saved with the application's edits, which start from its list entry.
  const saveNotes = (id: string, updated: Note[]) => {
    const record = recordOf.get(id);
    if (!record) return;
    const { status: _s, ...rest } = record.app;
    const base = record.savedEdits ?? rest;
    saveEdits.mutate({ id, config: { ...base, notes: updated.length ? updated : undefined } }, { onError: showError });
  };
  const handleNotesAdd = (id: string, text: string) => saveNotes(id, [createNote(text), ...(notesOf(id) ?? [])]);
  const handleNotesDelete = (id: string, noteId: string) =>
    saveNotes(
      id,
      (notesOf(id) ?? []).filter((n) => n.id !== noteId),
    );

  const trashSize = useTrashCount();

  const handleDelete = (app: ApplicationConfig) => {
    const message = `Move "${app.company} – ${app.role}" to the trash? You can restore it there for ${TRASH_RETENTION_DAYS} days.`;
    if (!confirm(message)) return;
    trash.mutate(app.id, { onError: showError });
  };

  const statsApps = allApps.map((app) => {
    const history = historyFor(app);
    const { appliedDate: _a, interviewDate: _i, finalDecisionDate: _f, ...rest } = app;
    return { ...rest, status: statusOf(history), ...derivedDates(history, languageFor(app)) };
  });

  // Checked jobs aren't applications yet, so the stats leave them out.
  const appliedApps = statsApps.filter((app) => app.status !== 'evaluated' && app.status !== 'skipped');

  const hasActiveFilter = !!(search || statusFilter || languageFilter || statFilter);
  const clearFilters = () => {
    setSearch('');
    setStatusFilter('');
    setLanguageFilter('');
    setStatFilter(null);
  };

  const toggleSort = (field: SortField) => {
    if (sortField === field) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortField(field);
      setSortDir('asc');
    }
  };

  const sortIndicator = (field: SortField) => (sortField === field ? (sortDir === 'asc' ? ' ▲' : ' ▼') : '');

  const visibleApps = statsApps
    .filter((app) => {
      const q = search.trim().toLowerCase();
      if (q && !app.company.toLowerCase().includes(q) && !app.role.toLowerCase().includes(q)) return false;
      if (statusFilter && app.status !== statusFilter) return false;
      // Jobs decided against stay out of the way unless asked for.
      if (!statusFilter && app.status === 'skipped') return false;
      if (languageFilter && languageFor(app) !== languageFilter) return false;
      if (!matchesStat(app, statFilter)) return false;
      return true;
    })
    .sort((a, b) => {
      if (!sortField) return 0;
      const value = (app: typeof a) => {
        if (sortField === 'language') return languageFor(app);
        // Scores sort as fixed-width numbers; unchecked jobs come first ascending.
        if (sortField === 'fit') return app.fit ? String(fitScore(app.fit)).padStart(3, '0') : '';
        // Dates are formatted per language, so compare them as ISO dates.
        if (sortField === 'appliedDate' || sortField === 'interviewDate' || sortField === 'finalDecisionDate') {
          return numericDateToIso(app[sortField] ?? '');
        }
        return app[sortField] ?? '';
      };
      const cmp = value(a).localeCompare(value(b));
      return sortDir === 'asc' ? cmp : -cmp;
    });

  return (
    <div className="min-h-screen bg-bg pt-6 px-4 pb-32 max-w-[1220px] mx-auto sm:pt-12 sm:px-8">
      <DashboardNav
        trashCount={trashSize}
        ratedLeadCount={ratedLeadCount}
        onImport={() => setImportOpen(true)}
        onBackup={() => setBackupOpen(true)}
      />

      <StatsBar applications={appliedApps} activeFilter={statFilter} onSelect={handleStatSelect} />

      {/* Search + filters */}
      <div className="flex flex-wrap items-center gap-2 mb-4">
        <input
          className="font-mono text-[12px] bg-transparent border border-rule text-ink-invert px-3 py-1.5 flex-1 basis-full sm:basis-0 min-w-0 outline-none focus:border-accent placeholder:text-ink-3"
          placeholder="search company or role..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <select
          className="font-mono text-[11px] bg-transparent border border-rule text-ink-2 px-2 py-1.5 cursor-pointer"
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value as ApplicationStatus | '')}
        >
          <option value="">all statuses</option>
          {(Object.entries(STATUS_LABELS) as [ApplicationStatus, string][]).map(([v, l]) => (
            <option key={v} value={v}>
              {l}
            </option>
          ))}
        </select>
        <select
          className="font-mono text-[11px] bg-transparent border border-rule text-ink-2 px-2 py-1.5 cursor-pointer"
          value={languageFilter}
          onChange={(e) => setLanguageFilter(e.target.value as AppLanguage | '')}
          aria-label="Filter by language"
        >
          <option value="">all languages</option>
          {(Object.entries(LANGUAGE_LABELS) as [AppLanguage, string][]).map(([v, l]) => (
            <option key={v} value={v}>
              {l}
            </option>
          ))}
        </select>
        {/* Below lg the sortable column headers are hidden, so sorting moves here */}
        <select
          className="lg:hidden font-mono text-[11px] bg-transparent border border-rule text-ink-2 px-2 py-1.5 cursor-pointer"
          value={sortField ?? ''}
          onChange={(e) => {
            setSortField((e.target.value || null) as SortField | null);
            setSortDir('asc');
          }}
          aria-label="Sort by"
        >
          <option value="">default order</option>
          {(Object.entries(SORT_LABELS) as [SortField, string][]).map(([v, l]) => (
            <option key={v} value={v}>
              sort: {l}
            </option>
          ))}
        </select>
        {sortField && (
          <button
            className="lg:hidden font-mono text-[11px] text-ink-2 bg-transparent border border-rule px-2.5 py-1.5 cursor-pointer"
            onClick={() => setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'))}
            aria-label={sortDir === 'asc' ? 'Sorted ascending' : 'Sorted descending'}
          >
            {sortDir === 'asc' ? '▲' : '▼'}
          </button>
        )}
        {hasActiveFilter && (
          <button
            className="font-mono text-[11px] text-ink-3 bg-transparent border-none cursor-pointer hover:text-status-rejected transition-colors"
            onClick={clearFilters}
          >
            clear
          </button>
        )}
      </div>

      {/* A table from lg up (scrolling sideways rather than crushing columns
          in narrow windows); below that each application is a card. */}
      <div data-tour="app-list" className="lg:overflow-x-auto">
        <div className="lg:min-w-[1052px]">
          {/* Column headers */}
          <div className="hidden lg:flex items-center border-b border-rule pb-1.5">
            <button
              className="font-mono text-[9.5px] uppercase tracking-[0.1em] text-ink-3 hover:text-ink-2 bg-transparent border-none cursor-pointer text-left p-0 w-[190px] shrink-0"
              onClick={() => toggleSort('company')}
            >
              company{sortIndicator('company')}
            </button>
            <button
              className="font-mono text-[9.5px] uppercase tracking-[0.1em] text-ink-3 hover:text-ink-2 bg-transparent border-none cursor-pointer text-left p-0 flex-1 min-w-[120px]"
              onClick={() => toggleSort('role')}
            >
              role{sortIndicator('role')}
            </button>
            <span className="w-[28px] shrink-0" />
            <button
              className="font-mono text-[9.5px] uppercase tracking-[0.1em] text-ink-3 hover:text-ink-2 bg-transparent border-none cursor-pointer text-center p-0 w-[44px] shrink-0"
              onClick={() => toggleSort('language')}
            >
              lang{sortIndicator('language')}
            </button>
            <button
              className="font-mono text-[9.5px] uppercase tracking-[0.1em] text-ink-3 hover:text-ink-2 bg-transparent border-none cursor-pointer text-right p-0 w-[48px] shrink-0"
              onClick={() => toggleSort('fit')}
            >
              fit{sortIndicator('fit')}
            </button>
            <button
              className="font-mono text-[9.5px] uppercase tracking-[0.1em] text-ink-3 hover:text-ink-2 bg-transparent border-none cursor-pointer text-right p-0 w-[116px] shrink-0 pr-1"
              onClick={() => toggleSort('status')}
            >
              status{sortIndicator('status')}
            </button>
            <button
              className="font-mono text-[9.5px] uppercase tracking-[0.1em] text-ink-3 hover:text-ink-2 bg-transparent border-none cursor-pointer text-right p-0 w-[88px] shrink-0 ml-2"
              onClick={() => toggleSort('appliedDate')}
            >
              applied{sortIndicator('appliedDate')}
            </button>
            <button
              className="font-mono text-[9.5px] uppercase tracking-[0.1em] text-ink-3 hover:text-ink-2 bg-transparent border-none cursor-pointer text-right p-0 w-[88px] shrink-0 ml-2"
              onClick={() => toggleSort('interviewDate')}
            >
              interview{sortIndicator('interviewDate')}
            </button>
            <button
              className="font-mono text-[9.5px] uppercase tracking-[0.1em] text-ink-3 hover:text-ink-2 bg-transparent border-none cursor-pointer text-right p-0 w-[88px] shrink-0 ml-2"
              onClick={() => toggleSort('finalDecisionDate')}
            >
              decision{sortIndicator('finalDecisionDate')}
            </button>
            <span className="font-mono text-[9.5px] uppercase tracking-[0.1em] text-ink-3 w-[170px] shrink-0 pl-3">
              notes
            </span>
            <span className="w-[36px] shrink-0" />
          </div>

          {allApps.length === 0 ? (
            <p className="font-mono text-[12px] text-ink-3 py-10">no applications found.</p>
          ) : visibleApps.length === 0 ? (
            <p className="font-mono text-[12px] text-ink-3 py-10">no applications match your search/filters.</p>
          ) : (
            <div className="grid gap-3 md:grid-cols-2 lg:block">
              {visibleApps.map((app) => {
                const isLocal = !staticApps.some((s) => s.id === app.id);
                return (
                  <ApplicationCard
                    key={app.id}
                    application={app}
                    language={languageFor(app)}
                    status={app.status}
                    canUndo={historyFor(app).length > 1}
                    appliedDate={app.appliedDate}
                    interviewDate={app.interviewDate}
                    finalDecisionDate={app.finalDecisionDate}
                    notes={notesOf(app.id)}
                    onStatusChange={(action) => handleStatusChange(app, action)}
                    onNotesAdd={(text) => handleNotesAdd(app.id, text)}
                    onNotesDelete={(noteId) => handleNotesDelete(app.id, noteId)}
                    onDelete={isLocal ? () => handleDelete(app) : undefined}
                  />
                );
              })}
            </div>
          )}
        </div>
      </div>

      {importOpen && <ImportApplicationModal onClose={() => setImportOpen(false)} />}
      {backupOpen && <BackupModal onClose={() => setBackupOpen(false)} />}
    </div>
  );
}
