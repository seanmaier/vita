import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { fetchKnowledge, saveKnowledge } from '../utils/api';
import type { KnowledgeDoc } from '../utils/api';
import { nafLabel, primaryButton } from '../styles/formStyles';
import { AutoTextarea } from '../components/AutoTextarea';
import { UnsavedChangesDialog } from '../components/UnsavedChangesDialog';

const TABS: { doc: KnowledgeDoc; label: string }[] = [
  { doc: 'about-me', label: 'About me' },
  { doc: 'priorities', label: 'Priorities' },
];

const tabClass = (active: boolean) =>
  `[font-family:var(--font-mono)] text-[11px] bg-transparent border-0 border-b-2 px-3 py-2 cursor-pointer ${
    active
      ? 'border-[color:var(--accent)] text-[color:var(--accent)]'
      : 'border-transparent text-[color:var(--ink-3)] hover:text-[color:var(--ink-invert)]'
  }`;

export function KnowledgePage() {
  const [doc, setDoc] = useState<KnowledgeDoc>('about-me');
  // `saved` is null while the document is loading.
  const [saved, setSaved] = useState<string | null>(null);
  const [content, setContent] = useState('');
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [justSaved, setJustSaved] = useState(false);
  const [busy, setBusy] = useState(false);
  const [pendingDoc, setPendingDoc] = useState<KnowledgeDoc | null>(null);

  const dirty = saved !== null && content !== saved;

  useEffect(() => {
    let cancelled = false;
    setSaved(null);
    setLoadError(null);
    fetchKnowledge(doc)
      .then((text) => {
        if (cancelled) return;
        // A missing document is just an empty one.
        setSaved(text ?? '');
        setContent(text ?? '');
      })
      .catch((e) => {
        if (!cancelled) setLoadError(e instanceof Error ? e.message : 'Loading the document failed.');
      });
    return () => {
      cancelled = true;
    };
  }, [doc]);

  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);

  const save = useCallback(async (): Promise<boolean> => {
    setBusy(true);
    setSaveError(null);
    setJustSaved(false);
    try {
      await saveKnowledge(doc, content);
      setSaved(content);
      setJustSaved(true);
      return true;
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : 'Saving the document failed.');
      return false;
    } finally {
      setBusy(false);
    }
  }, [doc, content]);

  const switchTo = (next: KnowledgeDoc) => {
    setSaveError(null);
    setJustSaved(false);
    setDoc(next);
  };

  const requestSwitch = (next: KnowledgeDoc) => {
    if (next === doc) return;
    if (dirty) setPendingDoc(next);
    else switchTo(next);
  };

  const saveAndSwitch = async () => {
    const next = pendingDoc;
    setPendingDoc(null);
    if (next && (await save())) switchTo(next);
  };

  const discardAndSwitch = () => {
    const next = pendingDoc;
    setPendingDoc(null);
    if (next) switchTo(next);
  };

  return (
    <div className="min-h-screen bg-[color:var(--bg)] pt-6 px-4 pb-32 max-w-[900px] mx-auto sm:pt-12 sm:px-8">
      <header className="mb-6 sm:mb-8 [font-family:var(--font-mono)] text-[15px] flex flex-wrap items-center gap-x-5 gap-y-1">
        <Link className="text-[11px] text-[color:var(--ink-3)] no-underline hover:text-[color:var(--ink-invert)]" to="/account">
          ← Account
        </Link>
        <span>
          <span className="text-[color:var(--ink-3)]">~/</span>
          <span className="text-[color:var(--accent)]">knowledge</span>
          <span className="text-[color:var(--ink-3)] animate-pulse"> _</span>
        </span>
      </header>

      <div className="flex border-b border-[color:var(--rule)] mb-5" role="tablist">
        {TABS.map((t) => (
          <button
            key={t.doc}
            className={tabClass(t.doc === doc)}
            type="button"
            role="tab"
            aria-selected={t.doc === doc}
            onClick={() => requestSwitch(t.doc)}
          >
            {t.label}
          </button>
        ))}
      </div>

      {loadError ? (
        <p className="text-[12px] text-[color:var(--status-rejected)]">{loadError}</p>
      ) : saved === null ? (
        <p className="[font-family:var(--font-mono)] text-[12px] text-[color:var(--ink-3)]">loading…</p>
      ) : (
        <div className="flex flex-col gap-4">
          <label className="flex flex-col gap-1.5">
            <span className={nafLabel}>{TABS.find((t) => t.doc === doc)?.label} (Markdown)</span>
            <AutoTextarea
              className="[font-family:var(--font-mono)] text-[12.5px] bg-[color:var(--surface)] border-[1.5px] border-[color:var(--rule)] rounded-[5px] py-2 px-[11px] text-[color:var(--ink-invert)] w-full min-h-[240px] leading-[1.55] focus:outline-none focus:border-[color:var(--accent)]"
              value={content}
              onChange={(e) => {
                setContent(e.target.value);
                setJustSaved(false);
              }}
            />
          </label>

          {saveError && <p className="text-[12px] text-[color:var(--status-rejected)]">{saveError}</p>}
          {justSaved && <p className="text-[12px] text-[color:var(--status-offer)]">Saved.</p>}

          <button className={primaryButton} type="button" disabled={busy || !dirty} onClick={() => void save()}>
            {busy ? 'saving…' : 'Save'}
          </button>
        </div>
      )}

      {pendingDoc && (
        <UnsavedChangesDialog
          onSave={() => void saveAndSwitch()}
          onDiscard={discardAndSwitch}
          onCancel={() => setPendingDoc(null)}
        />
      )}
    </div>
  );
}
