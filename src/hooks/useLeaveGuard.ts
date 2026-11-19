import { useEffect, useRef } from 'react';
import { useBlocker } from 'react-router-dom';

/**
 * Asks before leaving a page with unsaved edits: in-app navigation through
 * the returned blocker (show a dialog while it is "blocked"), closing or
 * reloading the tab through the browser's own prompt.
 */
export function useLeaveGuard(isDirty: boolean) {
  // Save/Reset trigger their own deliberate navigation right after already
  // persisting or discarding the changes — never block those. skipRef is
  // mutated synchronously right before calling navigate() in the same event
  // handler, before React re-renders, so the blocker must read it live via a
  // function (a plain boolean would bake in a stale snapshot from the last
  // render and still block that same-tick navigation).
  const skipRef = useRef(false);
  const blocker = useBlocker(() => isDirty && !skipRef.current);

  useEffect(() => {
    if (!isDirty) return;
    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [isDirty]);

  /** Lets the next navigation through, for a save or reset that already stored or dropped the edits. */
  const allowNextNavigation = () => {
    skipRef.current = true;
  };

  return { blocker, allowNextNavigation };
}
