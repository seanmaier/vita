import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { UnsavedChangesDialog } from './UnsavedChangesDialog';

function setup() {
  const handlers = { onSave: vi.fn(), onDiscard: vi.fn(), onCancel: vi.fn() };
  render(<UnsavedChangesDialog {...handlers} />);
  return handlers;
}

describe('UnsavedChangesDialog', () => {
  it.each([
    ['Save & leave', 'onSave'],
    ['Leave without saving', 'onDiscard'],
    ['Cancel', 'onCancel'],
  ] as const)('"%s" calls %s only', async (label, handler) => {
    const handlers = setup();
    await userEvent.click(screen.getByRole('button', { name: label }));
    for (const [name, fn] of Object.entries(handlers)) {
      expect(fn).toHaveBeenCalledTimes(name === handler ? 1 : 0);
    }
  });

  it('cancels on a click on the backdrop, not on the dialog itself', async () => {
    const { onCancel } = setup();
    await userEvent.click(screen.getByText('Unsaved changes'));
    expect(onCancel).not.toHaveBeenCalled();
    await userEvent.click(screen.getByText('Unsaved changes').parentElement!.parentElement!);
    expect(onCancel).toHaveBeenCalledOnce();
  });
});
