import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type { SkillGroup } from '#shared/types.ts';
import { SkillGroupsEditor } from './SkillGroupsEditor';

const groups: SkillGroup[] = [
  { label: 'Frontend', skills: ['React', 'TypeScript'] },
  { label: 'Backend', skills: ['Node'] },
];

// The editor is controlled: every edit is reported as the complete new list.
function setup(skillGroups = groups) {
  const onChange = vi.fn<(next: SkillGroup[]) => void>();
  render(<SkillGroupsEditor skillGroups={skillGroups} onChange={onChange} />);
  return { onChange, lastChange: () => onChange.mock.lastCall?.[0] };
}

describe('SkillGroupsEditor', () => {
  it('renames a group', () => {
    const { lastChange } = setup();
    fireEvent.change(screen.getByDisplayValue('Backend'), { target: { value: 'Server' } });
    expect(lastChange()?.[1]).toEqual({ label: 'Server', skills: ['Node'] });
  });

  it('marks a group as the learning variant', async () => {
    const { lastChange } = setup();
    await userEvent.click(screen.getAllByRole('checkbox', { name: 'learning variant' })[0]);
    expect(lastChange()?.[0].variant).toBe('learning');
  });

  it('adds an empty group with one empty skill', async () => {
    const { lastChange } = setup();
    await userEvent.click(screen.getByRole('button', { name: '+ Add skill group' }));
    expect(lastChange()).toEqual([...groups, { label: '', skills: [''] }]);
  });

  it('moves a group down and removes one', async () => {
    // One skill per group, so the only ↑/↓ buttons are the groups' own.
    const { lastChange } = setup([
      { label: 'Frontend', skills: ['React'] },
      { label: 'Backend', skills: ['Node'] },
    ]);
    await userEvent.click(screen.getAllByTitle('Move down')[0]);
    expect(lastChange()?.map((g) => g.label)).toEqual(['Backend', 'Frontend']);
    await userEvent.click(screen.getAllByRole('button', { name: 'Remove' })[0]);
    expect(lastChange()?.map((g) => g.label)).toEqual(['Backend']);
  });

  it('only offers to remove or move a skill while the group has more than one', () => {
    setup();
    // Two skills in "Frontend" get a ✕ each, the single skill in "Backend" none.
    expect(screen.getAllByRole('button', { name: '✕' })).toHaveLength(2);
  });

  it('edits and removes a single skill', async () => {
    const { lastChange } = setup();
    fireEvent.change(screen.getByDisplayValue('TypeScript'), { target: { value: 'TS' } });
    expect(lastChange()?.[0].skills).toEqual(['React', 'TS']);
    await userEvent.click(screen.getAllByRole('button', { name: '✕' })[0]);
    expect(lastChange()?.[0].skills).toEqual(['TypeScript']);
  });
});
