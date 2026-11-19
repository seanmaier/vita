import { useState } from 'react';
import { Link } from 'react-router-dom';
import type { AppLanguage, BaseProfile } from '#shared/types.ts';
import { LANG_FLAGS, LANGUAGE_LABELS, LANGUAGES } from '#shared/utils/language.ts';
import { ImportApplicationModal } from '../../components/ImportApplicationModal';
import { newAppBack, newAppHeader, newAppPage, newAppTitle } from '../../styles/formStyles';

/** The new-application page's top bar, on both of its steps. */
export function NewApplicationHeader() {
  return (
    <div className={newAppHeader}>
      <Link className={newAppBack} to="/">← Dashboard</Link>
      <span className={newAppTitle}>New Application</span>
      <ImportJsonButton />
    </div>
  );
}

// Header shortcut to create the whole application from pasted or uploaded
// JSON instead of filling in the form.
function ImportJsonButton() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        className="ml-auto [font-family:var(--font-mono)] text-[11px] bg-white/7 text-[color:var(--ink-invert)] border border-white/18 rounded px-3.5 py-[5px] cursor-pointer hover:bg-white/14"
        onClick={() => setOpen(true)}
      >
        Import JSON
      </button>
      {open && <ImportApplicationModal onClose={() => setOpen(false)} />}
    </>
  );
}

/** The first step: which base profile the new application uses, or which language's default. */
export function ChooseBaseProfileScreen({
  baseProfiles, onChoose, onSkip,
}: {
  baseProfiles: BaseProfile[];
  onChoose: (bp: BaseProfile) => void;
  onSkip: (language: AppLanguage) => void;
}) {
  return (
    <div className={newAppPage}>
      <NewApplicationHeader />

      <div className="flex-1 overflow-y-auto flex justify-center">
        <div className="w-full max-w-[560px] pt-14 px-6 flex flex-col gap-5">
          <div>
            <h1 className="text-[15px] font-semibold text-[color:var(--ink-invert)] m-0 mb-1.5">
              Choose a base profile
            </h1>
            <p className="[font-family:var(--font-mono)] text-[11.5px] text-[color:var(--ink-3)] m-0">
              Applications resolve their CV content from a base profile. Pick which one this application should use.
            </p>
          </div>

          <div className="flex flex-col gap-2">
            {baseProfiles.map((bp) => (
              <button
                key={bp.id}
                className="flex items-center gap-3 text-left bg-[color:var(--surface)] border border-[color:var(--rule)] rounded-[6px] py-3 px-4 cursor-pointer transition-colors duration-100 hover:border-[color:var(--accent)]"
                onClick={() => onChoose(bp)}
              >
                <span className="text-[14px] leading-none">{LANG_FLAGS[bp.language]}</span>
                <span className="[font-family:var(--font-sans)] text-[13px] text-[color:var(--ink-invert)]">{bp.name}</span>
              </button>
            ))}
          </div>

          <div className="flex items-center gap-3 mt-1">
            {LANGUAGES.map((lang) => (
              <button
                key={lang}
                className="[font-family:var(--font-mono)] text-[11px] bg-transparent text-[color:var(--ink-3)] border border-white/12 rounded px-3.5 py-[6px] cursor-pointer hover:text-[color:var(--ink-invert)]"
                onClick={() => onSkip(lang)}
              >
                Skip — {LANG_FLAGS[lang]} {LANGUAGE_LABELS[lang]} default
              </button>
            ))}
            <Link
              className="[font-family:var(--font-mono)] text-[11px] text-[color:var(--ink-3)] no-underline hover:text-[color:var(--accent)]"
              to="/profiles"
            >
              Manage base profiles →
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
