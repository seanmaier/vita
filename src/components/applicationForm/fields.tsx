// Layout pieces of the new/edit application forms, so each field reads as
// its label and its control instead of the same wrapper markup every time.
import type { ReactNode } from 'react';
import { nafCheckboxInput, nafCheckboxLabel, nafLabel, nafOptional, nafSection } from '../../styles/formStyles';

/** A labelled field; `hint` follows the label in a quieter style, e.g. "(optional)". */
export function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <div className={nafSection}>
      <span className={nafLabel}>
        {label}
        {hint && <> <span className={nafOptional}>{hint}</span></>}
      </span>
      {children}
    </div>
  );
}

/** A checkbox with its label, e.g. to switch an optional part of the form on. */
export function CheckboxField({ label, checked, onChange }: { label: string; checked: boolean; onChange: (checked: boolean) => void }) {
  return (
    <div className={nafSection}>
      <label className={nafCheckboxLabel}>
        <input className={nafCheckboxInput} type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
        {label}
      </label>
    </div>
  );
}
