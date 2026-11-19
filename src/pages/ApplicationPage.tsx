import { useEffect, useRef, useState } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import { applications } from '../data/applications';
import { getAllLocalApplications } from '../utils/localApplications';
import { TrashedNotice } from '../components/TrashedNotice';
import { resolveApplicationProfile } from '../utils/baseProfiles';
import { CVDocument } from '../components/cv/CVDocument';
import { FitToWidth } from '../components/FitToWidth';
import { CoverLetterDocument } from '../components/cover-letter/CoverLetterDocument';
import { ExportModal } from '../components/ExportModal';
import { useApplication } from '../hooks/useApplication';
import { useApplicationStatus } from '../hooks/useApplicationStatus';
import { STATUS_COLORS } from '../utils/status';
import { StatusOptions } from '../components/StatusOptions';
import type { StatusAction } from '../utils/statusTransitions';
import { FONT_LABELS, ALL_FONTS } from '../utils/fonts';
import { generateTextExport } from '../utils/textExport';
import { NotesDialog } from '../components/NotesDialog';
import { ApplicationTimeline } from '../components/ApplicationTimeline';
import { createNote } from '#shared/utils/notes.ts';
import { buildPdfFilename, type PrintTarget } from '../utils/pdfFilename';
import { sanitizeFolderName, writeApplicationPdfs, downloadPdfBlob } from '../utils/pdfExport';
import { pagesToTextPdf } from '../utils/pdfText';
import {
  isFileSystemAccessSupported,
  getSavedExportFolder,
  chooseExportFolder,
  ensureExportFolderPermission,
} from '../utils/exportFolder';
import { LANGUAGE_LABELS, languageOf } from '#shared/utils/language.ts';
import type { ApplicationConfig, AppFont, CoverLetter } from '#shared/types.ts';

export function ApplicationPage() {
  const { id } = useParams<{ id: string }>();
  const staticApp = id ? [...applications, ...getAllLocalApplications()].find((a) => a.id === id) : undefined;

  if (!staticApp) {
    return (
      <div className="py-20 px-10 font-mono text-ink-2 flex flex-col gap-4">
        <p>Application not found.</p>
        <Link className="text-accent" to="/">
          ← Back to dashboard
        </Link>
      </div>
    );
  }

  if (staticApp.deletedAt) return <TrashedNotice name={`${staticApp.company} – ${staticApp.role}`} />;

  return <ApplicationContent staticApp={staticApp} />;
}

function ApplicationContent({ staticApp }: { staticApp: ApplicationConfig }) {
  const { app, save, isDirty } = useApplication(staticApp);
  const { history, status, act, changeDate } = useApplicationStatus(staticApp);
  const [exportOpen, setExportOpen] = useState(false);
  const [exportFolderName, setExportFolderName] = useState<string | null>(null);
  const [downloading, setDownloading] = useState(false);
  const [notesOpen, setNotesOpen] = useState(false);
  const navigate = useNavigate();

  const cvExportRef = useRef<HTMLDivElement>(null);
  const clExportRef = useRef<HTMLDivElement>(null);

  const profile = resolveApplicationProfile(app);
  const language = languageOf(app);
  const fsaSupported = isFileSystemAccessSupported();

  useEffect(() => {
    getSavedExportFolder().then((handle) => setExportFolderName(handle?.name ?? null));
  }, []);

  const handleNotesAdd = (text: string) => {
    const { status: _s, ...rest } = app;
    save({ ...rest, notes: [createNote(text), ...(app.notes ?? [])] });
  };

  const handleNotesDelete = (id: string) => {
    const { status: _s, ...rest } = app;
    const updated = (app.notes ?? []).filter((n) => n.id !== id);
    save({ ...rest, notes: updated.length ? updated : undefined });
  };

  const handleFontChange = (font: AppFont) => {
    const { status: _s, ...rest } = app;
    save({ ...rest, font });
  };

  const handleChooseFolder = async () => {
    const handle = await chooseExportFolder();
    if (handle) setExportFolderName(handle.name);
  };

  const handleDownload = async () => {
    if (!profile.name.trim()) {
      const goToProfile = confirm(
        "Your profile has no name set yet, so the exported files can't be named properly. Set one now?",
      );
      if (goToProfile) navigate(app.baseProfileId ? `/profiles/${app.baseProfileId}` : '/profiles');
      return;
    }

    // Firefox doesn't support the File System Access API, so it falls back to
    // plain browser downloads below instead of saving into a chosen folder.
    let handle: FileSystemDirectoryHandle | undefined;
    if (fsaSupported) {
      handle = await getSavedExportFolder();
      if (!handle) {
        handle = await chooseExportFolder();
        if (!handle) return;
        setExportFolderName(handle.name);
      }

      const hasPermission = await ensureExportFolderPermission(handle);
      if (!hasPermission) {
        alert('Permission to write to the export folder was denied.');
        return;
      }
    }

    setDownloading(true);
    try {
      const cvPages = cvExportRef.current
        ? (Array.from(cvExportRef.current.querySelectorAll(':scope > .doc-page')) as HTMLElement[])
        : [];
      const clPages = clExportRef.current
        ? (Array.from(clExportRef.current.querySelectorAll(':scope > .doc-page')) as HTMLElement[])
        : [];

      const lang = app.language ?? 'en';
      const pdfName = (target: PrintTarget) => `${buildPdfFilename(target, lang, profile.name, app.company)}.pdf`;
      const files: Array<{ filename: string; blob: Blob }> = [
        { filename: pdfName('cv'), blob: pagesToTextPdf(cvPages) },
      ];
      if (clPages.length > 0) {
        files.push({ filename: pdfName('coverLetter'), blob: pagesToTextPdf(clPages) });
        files.push({ filename: pdfName('both'), blob: pagesToTextPdf([...cvPages, ...clPages]) });
      }

      // The company is already part of every filename, so plain downloads need no extra prefix.
      if (fsaSupported && handle) {
        await writeApplicationPdfs(handle, sanitizeFolderName(app.company), files);
      } else {
        files.forEach(({ filename, blob }) => downloadPdfBlob(filename, blob));
      }
    } catch (e) {
      console.error(e);
      alert('Something went wrong while exporting. Please try again.');
    } finally {
      setDownloading(false);
    }
  };

  return (
    <div className="min-h-screen bg-bg print:min-h-0 print:bg-white">
      {/* Sticky only from lg: below that the controls wrap onto several rows,
          which would cover too much of a phone screen while scrolling. */}
      <div className="lg:sticky top-0 z-10 bg-ink flex flex-wrap items-center justify-between px-4 sm:px-6 py-2 min-h-[52px] gap-x-4 gap-y-2 print:hidden">
        <Link className="font-mono text-[11px] text-ink-3 no-underline shrink-0 hover:text-ink-invert" to="/">
          ← Dashboard
        </Link>
        <div className="flex items-center gap-2.5 overflow-hidden min-w-0">
          <span className="text-[13px] font-semibold text-ink-invert whitespace-nowrap">{app.company}</span>
          <span className="text-[12px] text-ink-3 whitespace-nowrap overflow-hidden text-ellipsis">{app.role}</span>
          <span
            className="font-mono text-[9.5px] uppercase tracking-[0.06em] leading-none text-ink-2 border border-rule rounded px-1 py-[3px] shrink-0"
            title={LANGUAGE_LABELS[language]}
          >
            {language}
          </span>
          {isDirty && (
            <span className="font-mono text-[9px] tracking-[0.1em] uppercase text-status-sent border border-status-sent rounded-[10px] py-px px-[7px] opacity-80">
              edited
            </span>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-2.5">
          <select
            className="font-mono text-[11px] bg-white/7 border border-white/12 rounded px-2.5 py-[5px] cursor-pointer text-ink-2"
            value={app.font ?? 'sans'}
            onChange={(e) => handleFontChange(e.target.value as AppFont)}
          >
            {ALL_FONTS.map((f) => (
              <option key={f} value={f} className="text-ink-invert bg-surface">
                {FONT_LABELS[f]}
              </option>
            ))}
          </select>
          <select
            className="font-mono text-[11px] bg-white/7 border border-white/12 rounded px-2.5 py-[5px] cursor-pointer min-w-[140px]"
            value={status}
            style={{ color: STATUS_COLORS[status] }}
            onChange={(e) => act(e.target.value as StatusAction)}
            aria-label="Status"
          >
            <StatusOptions status={status} canUndo={history.length > 1} />
          </select>
          <Link
            className="font-mono text-[11px] bg-white/7 text-ink-invert border border-white/18 rounded px-3.5 py-[5px] cursor-pointer tracking-[0.04em] no-underline hover:bg-white/14"
            to={`/application/${staticApp.id}/edit`}
            data-tour="edit"
          >
            Edit
          </Link>
          <button
            className="font-mono text-[11px] bg-transparent text-accent border border-accent rounded px-3.5 py-[5px] cursor-pointer tracking-[0.04em] hover:bg-accent hover:text-ink"
            onClick={() => setExportOpen(true)}
            data-tour="export"
          >
            LLM Export
          </button>
          {fsaSupported && exportFolderName && (
            <span className="font-mono text-[10px] text-ink-3 whitespace-nowrap" title="Export folder">
              📁 {exportFolderName}
            </span>
          )}
          {fsaSupported && (
            <button
              className="font-mono text-[11px] bg-transparent text-ink-3 border border-white/12 rounded px-3 py-[5px] cursor-pointer hover:text-ink-invert hover:border-white/25"
              onClick={handleChooseFolder}
            >
              {exportFolderName ? 'change folder' : 'choose folder'}
            </button>
          )}
          <button
            className="font-mono text-[11px] bg-transparent text-accent border border-accent rounded px-3.5 py-[5px] cursor-pointer tracking-[0.04em] hover:bg-accent hover:text-ink disabled:opacity-50 disabled:cursor-not-allowed"
            onClick={handleDownload}
            disabled={downloading}
            data-tour="export"
          >
            {downloading ? 'Downloading…' : 'Download'}
          </button>
        </div>
      </div>

      {/* Documents with the notes panel beside them on wide windows; on
          narrower ones the panel moves above the documents. */}
      <div className="pt-6 px-3 sm:pt-10 sm:px-5 pb-20 flex flex-col items-center gap-6 min-[1200px]:flex-row min-[1200px]:items-start min-[1200px]:justify-center print:block print:p-0">
        <aside
          aria-label="Notes"
          className="w-[794px] max-w-full min-[1200px]:w-[300px] min-[1200px]:order-last min-[1200px]:sticky min-[1200px]:top-[76px] shrink-0 bg-surface border border-rule rounded-md p-4 flex flex-col gap-3 print:hidden"
        >
          <div className="flex items-center justify-between gap-2">
            <span className="font-mono text-[9.5px] tracking-[0.14em] uppercase text-accent">Notes</span>
            <button
              className="font-mono text-[11px] bg-transparent text-ink-2 border border-rule rounded px-2.5 py-1 cursor-pointer hover:text-ink-invert hover:border-ink-2"
              onClick={() => setNotesOpen(true)}
            >
              + Add
            </button>
          </div>
          {app.url && (
            <a
              href={app.url}
              target="_blank"
              rel="noopener noreferrer"
              title={app.url}
              className="font-mono text-[11.5px] text-accent underline underline-offset-2 truncate hover:opacity-80"
            >
              Job posting ↗
            </a>
          )}
          <div className="max-h-[calc(100vh-200px)] overflow-y-auto">
            <ApplicationTimeline
              app={app}
              history={history}
              status={status}
              language={language}
              onDeleteNote={handleNotesDelete}
              onChangeDate={changeDate}
            />
          </div>
        </aside>

        <div data-tour="documents" className="w-full max-w-[794px] shrink-0 print:max-w-none">
          <FitToWidth>
            <CVDocument profile={profile} application={{ ...app, status }} />
            {app.coverLetter && (
              <CoverLetterDocument
                profile={profile}
                application={{ ...app, status, coverLetter: app.coverLetter as CoverLetter }}
                paginate
              />
            )}
          </FitToWidth>
        </div>
      </div>

      {notesOpen && (
        <NotesDialog
          company={app.company}
          notes={app.notes ?? []}
          language={language}
          onAdd={handleNotesAdd}
          onDelete={handleNotesDelete}
          onClose={() => setNotesOpen(false)}
        />
      )}

      {/* Off-screen, A4-accurate copies the PDF download is written from — kept
          separate from the on-screen view above so its layout never affects it. */}
      {/* Intentionally off-screen rather than visibility/display-hidden — the PDF
          writer reads where the browser laid out every line, and hidden elements
          have no layout. */}
      <div className="pdf-export-root" style={{ position: 'absolute', top: 0, left: '-9999px' }}>
        <div ref={cvExportRef}>
          <CVDocument profile={profile} application={{ ...app, status }} />
        </div>
        {app.coverLetter && (
          <div ref={clExportRef}>
            <CoverLetterDocument
              profile={profile}
              application={{ ...app, status, coverLetter: app.coverLetter as CoverLetter }}
              paginate
            />
          </div>
        )}
      </div>

      {exportOpen && (
        <ExportModal text={generateTextExport(profile, { ...app, status })} onClose={() => setExportOpen(false)} />
      )}
    </div>
  );
}
