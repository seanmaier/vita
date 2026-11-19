import { useCallback, useEffect, useState } from 'react';
import { useBlocker } from 'react-router-dom';
import { fetchKnowledge, saveKnowledge } from '../utils/api';
import type { KnowledgeDoc } from '../utils/api';
import { hintText, nafLabel, primaryButton, tabClass } from '../styles/formStyles';
import { AutoTextarea } from '../components/AutoTextarea';
import { MarkdownView } from '../components/MarkdownView';
import { UnsavedChangesDialog } from '../components/UnsavedChangesDialog';
import { DocumentTextSkeleton } from '../components/Skeleton';

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
  const [editing, setEditing] = useState(false);
  const [pendingCancel, setPendingCancel] = useState(false);

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
      setEditing(false);
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
    setEditing(false);
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
      setPendingCancel(false);
      if (blocker.state === 'blocked') blocker.reset();
      return;
    }
    if (pendingDoc) switchTo(pendingDoc);
    setPendingDoc(null);
    setPendingCancel(false);
    if (blocker.state === 'blocked') blocker.proceed();
  };

  const discardAndLeave = () => {
    if (busy) return;
    if (pendingDoc) switchTo(pendingDoc);
    if (pendingCancel) {
      setContent(saved ?? '');
      setSaveError(null);
      setEditing(false);
    }
    setPendingDoc(null);
    setPendingCancel(false);
    if (blocker.state === 'blocked') blocker.proceed();
  };

  const cancelLeave = () => {
    if (busy) return;
    setPendingDoc(null);
    setPendingCancel(false);
    if (blocker.state === 'blocked') blocker.reset();
  };

  const requestCancelEdit = () => {
    if (dirty) {
      setPendingCancel(true);
      return;
    }
    setSaveError(null);
    setEditing(false);
  };

  // Cancelling edit mode gets its own wording; tab switches and navigation use the dialog's defaults.
  const cancelEditLabels = {
    message: 'You have unsaved edits. Save them, discard them, or keep editing?',
    cancelLabel: 'Keep editing',
    discardLabel: 'Discard changes',
    saveLabel: 'Save',
  };
  const dialogLabels = pendingCancel && !pendingDoc && blocker.state !== 'blocked' ? cancelEditLabels : {};

  return (
    <div>
      <p className={`${hintText} mb-4`}>
        Background about you that the AI assistant reads for applications and job checks.
      </p>

      <div className="flex border-b border-rule mb-5" role="tablist">
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
        <p className="text-[12px] text-status-rejected">{loadError}</p>
      ) : saved === null ? (
        <DocumentTextSkeleton />
      ) : (
        <div className="flex flex-col gap-4">
          {editing ? (
            <>
              <label className="flex flex-col gap-1.5">
                <span className={nafLabel}>{TABS.find((t) => t.doc === doc)?.label} (Markdown)</span>
                <AutoTextarea
                  extraLines={3}
                  className="font-mono text-[12.5px] bg-surface border-[1.5px] border-rule rounded-[5px] py-2 px-[11px] text-ink-invert w-full min-h-[120px] leading-[1.55] focus:outline-none focus:border-accent"
                  value={content}
                  onChange={(e) => {
                    setContent(e.target.value);
                    setJustSaved(false);
                  }}
                />
              </label>

              {saveError && <p className="text-[12px] text-status-rejected">{saveError}</p>}

              <div className="flex gap-2">
                <button className={primaryButton} type="button" disabled={busy || !dirty} onClick={() => void save()}>
                  {busy ? 'saving…' : 'save'}
                </button>
                <button className={primaryButton} type="button" disabled={busy} onClick={requestCancelEdit}>
                  cancel
                </button>
              </div>
            </>
          ) : (
            <>
              {saved === '' ? (
                <p className="font-mono text-[12px] text-ink-2">Nothing here yet.</p>
              ) : (
                <MarkdownView source={saved} />
              )}

              {saveError && <p className="text-[12px] text-status-rejected">{saveError}</p>}
              {justSaved && <p className="text-[12px] text-status-offer">Saved.</p>}

              <button className={primaryButton} type="button" onClick={() => {
                  setJustSaved(false);
                  setEditing(true);
                }}>
                edit
              </button>
            </>
          )}
        </div>
      )}

      {(pendingDoc || pendingCancel || blocker.state === 'blocked') && (
        <UnsavedChangesDialog
          {...dialogLabels}
          onSave={() => void saveAndLeave()}
          onDiscard={discardAndLeave}
          onCancel={cancelLeave}
        />
      )}
    </div>
  );
}
