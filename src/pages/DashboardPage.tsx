import { useState } from 'react';
import { applications as staticApps } from '../data/applications';
import { getLocalApplications, trashLocalApplication } from '../utils/localApplications';
import { countTrashed } from '../utils/trashCount';
import { TRASH_RETENTION_DAYS } from '../utils/trash';
import { getConfigOverride, setConfigOverride } from '../utils/appStorage';
import { STATUS_LABELS } from '../utils/status';
import { changeStatus, historyOf, statusOf, type StatusAction } from '../utils/statusTransitions';
import { derivedDates } from '../domain/statusMachine';
import { ApplicationCard } from '../components/dashboard/ApplicationCard';
import { fitScore } from '../components/dashboard/FitBadge';
import { ImportApplicationModal } from '../components/ImportApplicationModal';
import { BackupModal } from '../components/BackupModal';
import { DashboardNav } from '../components/dashboard/DashboardNav';
import { StatsBar } from '../components/dashboard/StatsBar';
import { numericDateToIso } from '../utils/date';
import { matchesStat, type StatKey } from '../utils/applicationStats';
import { useRatedLeadCount } from '../hooks/useRatedLeadCount';
import { createNote } from '../utils/notes';
import { LANGUAGE_LABELS, languageOf } from '../utils/language';
import type { AppLanguage, ApplicationConfig, ApplicationStatus, Note, StatusTransition } from '../types';

type SortField = 'company' | 'role' | 'language' | 'fit' | 'status' | 'appliedDate' | 'interviewDate' | 'finalDecisionDate';

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
  const [localApps, setLocalApps] = useState(() => getLocalApplications());
  const allApps = [...staticApps, ...localApps];

  // Status and the applied/interview/decision dates all follow each
  // application's status history.
  const [histories, setHistories] = useState<Record<string, StatusTransition[]>>(() =>
    Object.fromEntries(allApps.map((a) => [a.id, historyOf(a)])),
  );
  const historyFor = (app: ApplicationConfig) => histories[app.id] ?? historyOf(app);

  const [notes, setNotes] = useState<Record<string, Note[] | undefined>>(() =>
    Object.fromEntries(allApps.map((a) => [a.id, getConfigOverride(a.id)?.notes ?? a.notes])),
  );

  // Read once like the fields above: the language only changes in the edit
  // form, which lives on another page.
  const [languages] = useState<Record<string, AppLanguage>>(() =>
    Object.fromEntries(allApps.map((a) => [a.id, languageOf({ language: getConfigOverride(a.id)?.language ?? a.language })])),
  );
  const languageFor = (app: ApplicationConfig) => languages[app.id] ?? languageOf(app);

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

  const handleStatusChange = (app: ApplicationConfig, action: StatusAction) => {
    changeStatus(app.id, historyFor(app), action).then(
      (history) => setHistories((prev) => ({ ...prev, [app.id]: history })),
      (e) => alert(e instanceof Error ? e.message : String(e)),
    );
  };

  const handleNotesAdd = (id: string, text: string) => {
    const app = allApps.find((a) => a.id === id);
    if (!app) return;
    const { status: _s, ...rest } = app;
    const base = getConfigOverride(id) ?? rest;
    const updated = [createNote(text), ...(notes[id] ?? [])];
    setConfigOverride(id, { ...base, notes: updated });
    setNotes((prev) => ({ ...prev, [id]: updated }));
  };

  const handleNotesDelete = (id: string, noteId: string) => {
    const app = allApps.find((a) => a.id === id);
    if (!app) return;
    const { status: _s, ...rest } = app;
    const base = getConfigOverride(id) ?? rest;
    const updated = (notes[id] ?? []).filter((n) => n.id !== noteId);
    setConfigOverride(id, { ...base, notes: updated.length ? updated : undefined });
    setNotes((prev) => ({ ...prev, [id]: updated.length ? updated : undefined }));
  };

  const [trashSize, setTrashSize] = useState(countTrashed);

  const handleDelete = (app: ApplicationConfig) => {
    const message = `Move "${app.company} – ${app.role}" to the trash? You can restore it there for ${TRASH_RETENTION_DAYS} days.`;
    if (!confirm(message)) return;
    trashLocalApplication(app.id);
    setLocalApps(getLocalApplications());
    setTrashSize(countTrashed());
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
    <div className="min-h-screen bg-[color:var(--bg)] pt-6 px-4 pb-32 max-w-[1220px] mx-auto sm:pt-12 sm:px-8">
      <DashboardNav trashCount={trashSize} ratedLeadCount={ratedLeadCount} onImport={() => setImportOpen(true)} onBackup={() => setBackupOpen(true)} />

      <StatsBar applications={appliedApps} activeFilter={statFilter} onSelect={handleStatSelect} />

      {/* Search + filters */}
      <div className="flex flex-wrap items-center gap-2 mb-4">
        <input
          className="[font-family:var(--font-mono)] text-[12px] bg-transparent border border-[color:var(--rule)] text-[color:var(--ink-invert)] px-3 py-1.5 flex-1 basis-full sm:basis-0 min-w-0 outline-none focus:border-[color:var(--accent)] placeholder:text-[color:var(--ink-3)]"
          placeholder="search company or role..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <select
          className="[font-family:var(--font-mono)] text-[11px] bg-transparent border border-[color:var(--rule)] text-[color:var(--ink-2)] px-2 py-1.5 cursor-pointer"
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value as ApplicationStatus | '')}
        >
          <option value="">all statuses</option>
          {(Object.entries(STATUS_LABELS) as [ApplicationStatus, string][]).map(([v, l]) => (
            <option key={v} value={v}>{l}</option>
          ))}
        </select>
        <select
          className="[font-family:var(--font-mono)] text-[11px] bg-transparent border border-[color:var(--rule)] text-[color:var(--ink-2)] px-2 py-1.5 cursor-pointer"
          value={languageFilter}
          onChange={(e) => setLanguageFilter(e.target.value as AppLanguage | '')}
          aria-label="Filter by language"
        >
          <option value="">all languages</option>
          {(Object.entries(LANGUAGE_LABELS) as [AppLanguage, string][]).map(([v, l]) => (
            <option key={v} value={v}>{l}</option>
          ))}
        </select>
        {/* Below lg the sortable column headers are hidden, so sorting moves here */}
        <select
          className="lg:hidden [font-family:var(--font-mono)] text-[11px] bg-transparent border border-[color:var(--rule)] text-[color:var(--ink-2)] px-2 py-1.5 cursor-pointer"
          value={sortField ?? ''}
          onChange={(e) => { setSortField((e.target.value || null) as SortField | null); setSortDir('asc'); }}
          aria-label="Sort by"
        >
          <option value="">default order</option>
          {(Object.entries(SORT_LABELS) as [SortField, string][]).map(([v, l]) => (
            <option key={v} value={v}>sort: {l}</option>
          ))}
        </select>
        {sortField && (
          <button
            className="lg:hidden [font-family:var(--font-mono)] text-[11px] text-[color:var(--ink-2)] bg-transparent border border-[color:var(--rule)] px-2.5 py-1.5 cursor-pointer"
            onClick={() => setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'))}
            aria-label={sortDir === 'asc' ? 'Sorted ascending' : 'Sorted descending'}
          >
            {sortDir === 'asc' ? '▲' : '▼'}
          </button>
        )}
        {hasActiveFilter && (
          <button
            className="[font-family:var(--font-mono)] text-[11px] text-[color:var(--ink-3)] bg-transparent border-none cursor-pointer hover:text-[color:var(--status-rejected)] transition-colors"
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
      <div className="hidden lg:flex items-center border-b border-[color:var(--rule)] pb-1.5">
        <button
          className="[font-family:var(--font-mono)] text-[9.5px] uppercase tracking-[0.1em] text-[color:var(--ink-3)] hover:text-[color:var(--ink-2)] bg-transparent border-none cursor-pointer text-left p-0 w-[190px] shrink-0"
          onClick={() => toggleSort('company')}
        >
          company{sortIndicator('company')}
        </button>
        <button
          className="[font-family:var(--font-mono)] text-[9.5px] uppercase tracking-[0.1em] text-[color:var(--ink-3)] hover:text-[color:var(--ink-2)] bg-transparent border-none cursor-pointer text-left p-0 flex-1 min-w-[120px]"
          onClick={() => toggleSort('role')}
        >
          role{sortIndicator('role')}
        </button>
        <span className="w-[28px] shrink-0" />
        <button
          className="[font-family:var(--font-mono)] text-[9.5px] uppercase tracking-[0.1em] text-[color:var(--ink-3)] hover:text-[color:var(--ink-2)] bg-transparent border-none cursor-pointer text-center p-0 w-[44px] shrink-0"
          onClick={() => toggleSort('language')}
        >
          lang{sortIndicator('language')}
        </button>
        <button
          className="[font-family:var(--font-mono)] text-[9.5px] uppercase tracking-[0.1em] text-[color:var(--ink-3)] hover:text-[color:var(--ink-2)] bg-transparent border-none cursor-pointer text-right p-0 w-[48px] shrink-0"
          onClick={() => toggleSort('fit')}
        >
          fit{sortIndicator('fit')}
        </button>
        <button
          className="[font-family:var(--font-mono)] text-[9.5px] uppercase tracking-[0.1em] text-[color:var(--ink-3)] hover:text-[color:var(--ink-2)] bg-transparent border-none cursor-pointer text-right p-0 w-[116px] shrink-0 pr-1"
          onClick={() => toggleSort('status')}
        >
          status{sortIndicator('status')}
        </button>
        <button
          className="[font-family:var(--font-mono)] text-[9.5px] uppercase tracking-[0.1em] text-[color:var(--ink-3)] hover:text-[color:var(--ink-2)] bg-transparent border-none cursor-pointer text-right p-0 w-[88px] shrink-0 ml-2"
          onClick={() => toggleSort('appliedDate')}
        >
          applied{sortIndicator('appliedDate')}
        </button>
        <button
          className="[font-family:var(--font-mono)] text-[9.5px] uppercase tracking-[0.1em] text-[color:var(--ink-3)] hover:text-[color:var(--ink-2)] bg-transparent border-none cursor-pointer text-right p-0 w-[88px] shrink-0 ml-2"
          onClick={() => toggleSort('interviewDate')}
        >
          interview{sortIndicator('interviewDate')}
        </button>
        <button
          className="[font-family:var(--font-mono)] text-[9.5px] uppercase tracking-[0.1em] text-[color:var(--ink-3)] hover:text-[color:var(--ink-2)] bg-transparent border-none cursor-pointer text-right p-0 w-[88px] shrink-0 ml-2"
          onClick={() => toggleSort('finalDecisionDate')}
        >
          decision{sortIndicator('finalDecisionDate')}
        </button>
        <span className="[font-family:var(--font-mono)] text-[9.5px] uppercase tracking-[0.1em] text-[color:var(--ink-3)] w-[170px] shrink-0 pl-3">
          notes
        </span>
        <span className="w-[36px] shrink-0" />
      </div>

      {allApps.length === 0 ? (
        <p className="[font-family:var(--font-mono)] text-[12px] text-[color:var(--ink-3)] py-10">
          no applications found.
        </p>
      ) : visibleApps.length === 0 ? (
        <p className="[font-family:var(--font-mono)] text-[12px] text-[color:var(--ink-3)] py-10">
          no applications match your search/filters.
        </p>
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
                notes={notes[app.id]}
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
