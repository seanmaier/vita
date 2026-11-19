import { AutoTextarea } from '../AutoTextarea';
import { ExportParagraphsButton } from '../ExportParagraphsButton';
import { ImportParagraphsControl } from '../ImportParagraphsControl';
import { MoveButtons } from '../MoveButtons';
import { move } from '../../utils/move';
import { nafAddBtn, nafParagraphRow, nafRemoveBtn, nafTextarea } from '../../styles/formStyles';
import { Field } from './fields';

/** The cover letter's paragraphs: edit, reorder, add and remove them, or import and export them all. */
export function CoverLetterParagraphs({ paragraphs, onChange }: { paragraphs: string[]; onChange: (next: string[]) => void }) {
  const update = (i: number, value: string) => onChange(paragraphs.map((p, idx) => (idx === i ? value : p)));
  const remove = (i: number) => onChange(paragraphs.filter((_, idx) => idx !== i));

  return (
    <Field label="Cover letter paragraphs">
      <ImportParagraphsControl onImport={onChange} />
      <ExportParagraphsButton paragraphs={paragraphs} />
      {paragraphs.map((p, i) => (
        <div className={nafParagraphRow} key={i}>
          <AutoTextarea className={nafTextarea} placeholder={`Paragraph ${i + 1}`} value={p} onChange={(e) => update(i, e.target.value)} />
          {paragraphs.length > 1 && (
            <>
              <MoveButtons index={i} length={paragraphs.length} onMove={(to) => onChange(move(paragraphs, i, to))} />
              <button className={nafRemoveBtn} onClick={() => remove(i)}>✕</button>
            </>
          )}
        </div>
      ))}
      <button className={nafAddBtn} onClick={() => onChange([...paragraphs, ''])}>+ Add paragraph</button>
    </Field>
  );
}
