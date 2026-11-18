interface Props {
  onSave: () => void;
  onDiscard: () => void;
  onCancel: () => void;
  message?: string;
  cancelLabel?: string;
  discardLabel?: string;
  saveLabel?: string;
}

export function UnsavedChangesDialog({
  onSave,
  onDiscard,
  onCancel,
  message = 'You have unsaved edits. Save them before leaving, or discard them?',
  cancelLabel = 'Cancel',
  discardLabel = 'Leave without saving',
  saveLabel = 'Save & leave',
}: Props) {
  return (
    <div
      className="fixed inset-0 bg-[rgba(20,28,46,0.65)] flex items-center justify-center z-[100] p-3 sm:p-6"
      onClick={onCancel}
    >
      <div
        className="bg-[#1a2236] rounded-lg w-full max-w-[420px] p-6 flex flex-col gap-4 shadow-[0_20px_60px_rgba(20,28,46,0.40)]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="font-mono text-[12px] font-semibold tracking-[0.04em] uppercase text-ink-invert">
          Unsaved changes
        </div>
        <p className="text-[13px] text-ink-2 leading-[1.55] m-0">
          {message}
        </p>
        <div className="flex justify-end gap-2 mt-1">
          <button
            className="font-mono text-[11px] bg-transparent text-ink-3 border border-white/12 rounded px-3.5 py-[6px] cursor-pointer hover:text-ink-invert"
            onClick={onCancel}
          >
            {cancelLabel}
          </button>
          <button
            className="font-mono text-[11px] bg-transparent text-status-rejected border border-status-rejected rounded px-3.5 py-[6px] cursor-pointer hover:bg-status-rejected hover:text-ink"
            onClick={onDiscard}
          >
            {discardLabel}
          </button>
          <button
            className="font-mono text-[11px] bg-accent text-ink font-semibold border-none rounded px-4 py-[6px] cursor-pointer hover:brightness-110"
            onClick={onSave}
          >
            {saveLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
