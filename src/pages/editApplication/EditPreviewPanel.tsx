import { useState } from 'react';
import type { ApplicationConfig, CoverLetter, Profile } from '#shared/types.ts';
import { CVDocument } from '../../components/cv/CVDocument';
import { CoverLetterDocument } from '../../components/cover-letter/CoverLetterDocument';
import { FitToWidth } from '../../components/FitToWidth';
import { JsonConfigPanel } from '../../components/JsonConfigPanel';
import { applicationIdFor } from '#shared/utils/slug.ts';
import { napFilename, napHeader, napHint, newAppPreview } from '../../styles/formStyles';

interface Props {
  /** The application as the form currently describes it, unsaved edits included. */
  application: ApplicationConfig;
  profile: Profile;
  /** Saves a config edited as JSON. */
  onApplyJson: (config: ApplicationConfig) => void;
  className?: string;
}

/**
 * The right-hand panel: a live preview of CV and cover letter, or the raw
 * JSON config to edit. jsonBaseline is the JSON as generated when switching
 * over, so switching back can tell whether there are unapplied edits.
 */
export function EditPreviewPanel({ application, profile, onApplyJson, className = '' }: Props) {
  const [view, setView] = useState<'preview' | 'json'>('preview');
  const [jsonText, setJsonText] = useState('');
  const [jsonBaseline, setJsonBaseline] = useState('');
  const fileName = `${applicationIdFor(application.company)}.json`;

  const switchView = (next: 'preview' | 'json') => {
    if (next === view) return;
    if (next === 'json') {
      const { status: _status, ...config } = application;
      const text = JSON.stringify(config, null, 2);
      setJsonText(text);
      setJsonBaseline(text);
    } else if (jsonText !== jsonBaseline && !confirm('Discard your unapplied JSON edits?')) {
      return;
    }
    setView(next);
  };

  return (
    <div className={`${newAppPreview} ${className}`}>
      <div className={napHeader}>
        <span className={napFilename}>private/applications/{fileName}</span>
        <div className="flex items-center gap-1 bg-white/5 rounded p-0.5" role="tablist" aria-label="Right panel view">
          {(['preview', 'json'] as const).map((option) => (
            <button
              key={option}
              role="tab"
              aria-selected={view === option}
              className={`[font-family:var(--font-mono)] text-[10.5px] tracking-[0.06em] rounded px-3 py-1 border-none cursor-pointer transition-colors ${
                view === option
                  ? 'bg-[color:var(--accent)] text-[color:var(--ink)]'
                  : 'bg-transparent text-[#8896AB] hover:text-[color:var(--ink-invert)]'
              }`}
              onClick={() => switchView(option)}
            >
              {option === 'preview' ? 'live preview' : 'JSON'}
            </button>
          ))}
        </div>
      </div>
      {view === 'json' ? (
        <JsonConfigPanel text={jsonText} onTextChange={setJsonText} onApply={onApplyJson} />
      ) : (
        <div className="flex-1 overflow-y-auto">
          <div className="py-6 px-3 sm:py-8 sm:px-5">
            <FitToWidth>
              <CVDocument profile={profile} application={application} />
              {application.coverLetter && (
                <CoverLetterDocument
                  profile={profile}
                  application={{ ...application, coverLetter: application.coverLetter as CoverLetter }}
                  paginate
                />
              )}
            </FitToWidth>
          </div>
        </div>
      )}
      <p className={napHint}>
        {view === 'json'
          ? <>Starts from the form, unsaved edits included. <code>Apply JSON</code> saves it and reloads the form.</>
          : <>Changes are saved to your account as you edit. Switch to <code>JSON</code> to edit or copy the config for <code>private/applications/{fileName}</code>.</>}
      </p>
    </div>
  );
}
