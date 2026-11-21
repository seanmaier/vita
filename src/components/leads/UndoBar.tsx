import { useEffect } from 'react';

/** How long the undo bar stays before the change is final in the UI. */
export const UNDO_MS = 8000;

/** A fixed bar at the bottom: what just happened, with an undo button; hides itself after UNDO_MS. */
export function UndoBar({ message, onUndo, onDone }: { message: string; onUndo: () => void; onDone: () => void }) {
  useEffect(() => {
    const timer = setTimeout(onDone, UNDO_MS);
    return () => clearTimeout(timer);
  }, [message, onDone]);
  return (
    <div
      className="fixed bottom-4 left-1/2 -translate-x-1/2 w-[calc(100%-2rem)] max-w-[560px] bg-surface border border-rule rounded-[5px] px-4 py-2.5 flex items-center justify-between gap-3 shadow-lg z-20"
      role="status"
    >
      <span className="text-[12.5px] text-ink-2 min-w-0 break-words">{message}</span>
      <button
        className="font-mono text-[11px] bg-transparent border-0 text-accent cursor-pointer hover:underline shrink-0"
        type="button"
        onClick={onUndo}
      >
        Undo
      </button>
    </div>
  );
}
