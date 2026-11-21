import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import type { ApplicationConfig, BaseProfile } from '#shared/types.ts';
import { applicationsUsingBaseProfile } from '../utils/baseProfiles';
import { useBaseProfileMutations, useDeletedBaseProfiles } from '../api/baseProfiles';
import { QueryState } from '../components/QueryState';
import { effectiveApp, useApplicationMutations, useApplications } from '../api/applications';
import { combine } from '../api/combine';
import { purgeDate, TRASH_RETENTION_DAYS } from '#shared/utils/trash.ts';
import { LANG_FLAGS } from '#shared/utils/language.ts';

const actionBtn =
  'font-mono text-[11px] text-ink-2 bg-transparent border border-rule rounded px-2.5 py-1 cursor-pointer transition-colors';
const meta = 'font-mono text-[11px] text-ink-3';
const sectionLabel = 'font-mono text-[9.5px] uppercase tracking-[0.14em] text-accent mb-2';

const formatDate = (iso: string | Date) =>
  new Date(iso).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });

// Newest deletions first: those are the ones most likely to be restored.
function newestFirst<T extends { deletedAt?: string }>(items: T[]): T[] {
  return [...items].sort((a, b) => (b.deletedAt ?? '').localeCompare(a.deletedAt ?? ''));
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

interface RowProps {
  title: ReactNode;
  deletedAt: string;
  extra?: string;
  onRestore: () => void;
  onDeletePermanently: () => void;
}

function TrashRow({ title, deletedAt, extra, onRestore, onDeletePermanently }: RowProps) {
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-rule py-2.5">
      <div className="flex-1 min-w-[200px]">
        <span className="block font-mono text-[12.5px] text-ink-invert truncate">{title}</span>
        <span className={`block ${meta} mt-0.5`}>
          deleted {formatDate(deletedAt)} · removed {formatDate(purgeDate(deletedAt))}
          {extra && ` · ${extra}`}
        </span>
      </div>
      <div className="flex items-center gap-2">
        <button className={`${actionBtn} hover:text-accent hover:border-accent`} onClick={onRestore}>
          restore
        </button>
        <button
          className={`${actionBtn} hover:text-status-rejected hover:border-status-rejected`}
          onClick={onDeletePermanently}
        >
          delete permanently
        </button>
      </div>
    </div>
  );
}

function Section({ label, empty, children }: { label: string; empty: boolean; children: ReactNode }) {
  return (
    <section className="mb-10">
      <h2 className={sectionLabel}>{label}</h2>
      {empty ? <p className={`${meta} py-4`}>nothing here.</p> : children}
    </section>
  );
}

/** Soft-deleted applications and base profiles: restore them, or delete them for good before the server purges them. */
export function TrashPage() {
  const query = combine({ records: useApplications(), trashed: useDeletedBaseProfiles() });
  const { restore: restoreProfile, remove: removeProfile } = useBaseProfileMutations();
  const { restore: restoreApplication, remove: removeApplication } = useApplicationMutations();
  const showError = { onError: (e: Error) => alert(e.message) };
  const records = query.data?.records ?? [];

  const deleteApplication = (app: ApplicationConfig) => {
    if (
      !confirm(
        `Delete "${app.company} – ${app.role}" permanently, with its cover letter and notes? This cannot be undone.`,
      )
    )
      return;
    removeApplication.mutate(app.id, showError);
  };

  const deleteProfile = (profile: BaseProfile) => {
    const usedBy = applicationsUsingBaseProfile(profile.id, records);
    const fallback =
      usedBy.length > 0
        ? ` ${plural(usedBy.length, 'application')} (${usedBy.map((a) => a.company).join(', ')}) ` +
          'will fall back to the language default profile.'
        : '';
    if (!confirm(`Delete "${profile.name}" permanently? This cannot be undone.${fallback}`)) return;
    removeProfile.mutate(profile.id, showError);
  };

  return (
    <div className="min-h-screen bg-bg pt-6 px-4 pb-32 max-w-[900px] mx-auto sm:pt-12 sm:px-8">
      <header className="mb-6 sm:mb-8 font-mono text-[15px] flex flex-wrap items-center gap-x-5 gap-y-1">
        <Link className="text-[11px] text-ink-3 no-underline hover:text-ink-invert" to="/">
          ← Dashboard
        </Link>
        <span>
          <span className="text-ink-3">~/</span>
          <span className="text-accent">trash</span>
          <span className="text-ink-3 animate-pulse"> _</span>
        </span>
      </header>

      <p className={`${meta} mb-8 leading-[1.6]`}>
        Deleted applications and base profiles stay here for {TRASH_RETENTION_DAYS} days, then they're removed for good.
        A trashed base profile keeps rendering for the applications that use it until then.
      </p>

      <QueryState query={query}>
        {({ records, trashed }) => {
          const applications = newestFirst(records.filter((r) => r.app.deletedAt).map(effectiveApp));
          return (
            <>
              <Section label="applications" empty={applications.length === 0}>
                {applications.map((a) => (
                  <TrashRow
                    key={a.id}
                    title={`${LANG_FLAGS[a.language ?? 'en']} ${a.company} – ${a.role}`}
                    deletedAt={a.deletedAt!}
                    onRestore={() => restoreApplication.mutate(a.id, showError)}
                    onDeletePermanently={() => deleteApplication(a)}
                  />
                ))}
              </Section>
              <Section label="base profiles" empty={trashed.length === 0}>
                {newestFirst(trashed).map((p) => {
                  const usedBy = applicationsUsingBaseProfile(p.id, records).length;
                  return (
                    <TrashRow
                      key={p.id}
                      title={`${LANG_FLAGS[p.language]} ${p.name}`}
                      deletedAt={p.deletedAt!}
                      extra={usedBy > 0 ? `used by ${plural(usedBy, 'application')}` : undefined}
                      onRestore={() => restoreProfile.mutate(p.id, showError)}
                      onDeletePermanently={() => deleteProfile(p)}
                    />
                  );
                })}
              </Section>
            </>
          );
        }}
      </QueryState>
    </div>
  );
}
