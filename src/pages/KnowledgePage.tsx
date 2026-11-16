import { useCallback, useEffect, useState } from 'react';
import { useBlocker } from 'react-router-dom';
import { fetchKnowledge, saveKnowledge } from '../utils/api';
import type { KnowledgeDoc } from '../utils/api';
import { nafLabel, primaryButton, tabClass } from '../styles/formStyles';
import { AutoTextarea } from '../components/AutoTextarea';
import { UnsavedChangesDialog } from '../components/UnsavedChangesDialog';

const TABS: { doc: KnowledgeDoc; label: string }[] = [
  { doc: 'about-me', label: 'About me' },
  { doc: 'priorities', label: 'Priorities' },
];

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
  // Guards in-app navigation (links, browser Back); tab switches are guarded below.
  const blocker = useBlocker(dirty);

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

  // The dialog stays open until a save resolves, and ignores clicks meanwhile,
  // so a late save result can never land on another tab.
  const saveAndLeave = async () => {
    if (busy) return;
    if (!(await save())) {
      setPendingDoc(null);
      if (blocker.state === 'blocked') blocker.reset();
      return;
    }
    if (pendingDoc) switchTo(pendingDoc);
    setPendingDoc(null);
    if (blocker.state === 'blocked') blocker.proceed();
  };

  const discardAndLeave = () => {
    if (busy) return;
    if (pendingDoc) switchTo(pendingDoc);
    setPendingDoc(null);
    if (blocker.state === 'blocked') blocker.proceed();
  };

  const cancelLeave = () => {
    if (busy) return;
    setPendingDoc(null);
    if (blocker.state === 'blocked') blocker.reset();
  };

  return (
    <div>
      <p className="[font-family:var(--font-mono)] text-[10.5px] text-[color:var(--ink-3)] mb-4">
        Background about you that the AI assistant reads for applications and job checks.
      </p>

      <div className="flex border-b border-[color:var(--rule)] mb-5" role="tablist">
        {TABS.map((t) => (
          <button
            key={t.doc}
            className={tabClass(t.doc === doc)}
            type="button"
            role="tab"
            aria-selected={t.doc === doc}
            disabled={busy}
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

      {(pendingDoc || blocker.state === 'blocked') && (
        <UnsavedChangesDialog
          onSave={() => void saveAndLeave()}
          onDiscard={discardAndLeave}
          onCancel={cancelLeave}
        />
      )}
    </div>
  );
}
