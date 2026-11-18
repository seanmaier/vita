import type { AppFont } from '../../types';
import { ALL_FONTS, FONT_LABELS } from '../../utils/fonts';
import { nafInput, nafRow } from '../../styles/formStyles';
import { Field } from './fields';

export interface Basics {
  company: string;
  role: string;
  url: string;
  font: AppFont;
}

/** Company, role, job posting URL and font: the fields every application has. */
export function BasicsFields({ value, onChange }: { value: Basics; onChange: (patch: Partial<Basics>) => void }) {
  return (
    <>
      <Field label="Company">
        <input className={nafInput} placeholder="e.g. Vattenfall" value={value.company} onChange={(e) => onChange({ company: e.target.value })} />
      </Field>

      <Field label="Role">
        <input className={nafInput} placeholder="e.g. Backend Engineer" value={value.role} onChange={(e) => onChange({ role: e.target.value })} />
      </Field>

      <Field label="Job posting URL" hint="(optional)">
        <input className={nafInput} placeholder="https://..." value={value.url} onChange={(e) => onChange({ url: e.target.value })} />
      </Field>

      <div className={nafRow}>
        <Field label="Font">
          <select className={nafInput} value={value.font} onChange={(e) => onChange({ font: e.target.value as AppFont })}>
            {ALL_FONTS.map((f) => (
              <option key={f} value={f}>{FONT_LABELS[f]}</option>
            ))}
          </select>
        </Field>
      </div>
    </>
  );
}
