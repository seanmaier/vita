import type { AppLanguage, BaseProfile, Profile } from '#shared/types.ts';
import { LANG_FLAGS, LANGUAGE_LABELS, LANGUAGES } from '#shared/utils/language.ts';
import { DEFAULT_CLOSINGS } from '../../utils/coverLetterClosing';
import { AutoTextarea } from '../../components/AutoTextarea';
import { FeaturedProjectsPicker } from '../../components/FeaturedProjectsPicker';
import { SkillGroupsEditor } from '../../components/SkillGroupsEditor';
import { ExportSkillGroupsButton } from '../../components/ExportSkillGroupsButton';
import { BasicsFields } from '../../components/applicationForm/BasicsFields';
import { CoverLetterParagraphs } from '../../components/applicationForm/CoverLetterParagraphs';
import { CheckboxField, Field } from '../../components/applicationForm/fields';
import { nafAddBtn, nafInput, nafOptional, nafRow, nafTextarea } from '../../styles/formStyles';
import type { EditForm } from './editForm';

const LANGUAGE_DEFAULT_PREFIX = 'language-default:';

interface Props {
  form: EditForm;
  onChange: (patch: Partial<EditForm>) => void;
  baseProfiles: BaseProfile[];
  /** The profile the application currently shows (base profile or language default). */
  profile: Profile;
  onImportSkillGroups: () => void;
}

/** Every field of the edit form, top to bottom. */
export function EditFormFields({ form, onChange, baseProfiles, profile, onImportSkillGroups }: Props) {
  // The language always comes from the profile: a base profile carries its
  // own, and the fallback options pick one of the per-language defaults.
  const changeBaseProfile = (value: string) => {
    if (value.startsWith(LANGUAGE_DEFAULT_PREFIX)) {
      onChange({ baseProfileId: '', language: value.slice(LANGUAGE_DEFAULT_PREFIX.length) as AppLanguage });
      return;
    }
    const bp = baseProfiles.find((p) => p.id === value);
    onChange({ baseProfileId: value, ...(bp && { language: bp.language }) });
  };

  return (
    <>
      <Field label="Base profile">
        <select
          className={nafInput}
          value={form.baseProfileId || `${LANGUAGE_DEFAULT_PREFIX}${form.language}`}
          onChange={(e) => changeBaseProfile(e.target.value)}
        >
          {baseProfiles.length > 0 && (
            <optgroup label="Base profiles">
              {baseProfiles.map((bp) => (
                <option key={bp.id} value={bp.id}>{LANG_FLAGS[bp.language]} {bp.name}</option>
              ))}
            </optgroup>
          )}
          <optgroup label="Language defaults">
            {LANGUAGES.map((lang) => (
              <option key={lang} value={`${LANGUAGE_DEFAULT_PREFIX}${lang}`}>
                {LANG_FLAGS[lang]} {LANGUAGE_LABELS[lang]} default
              </option>
            ))}
          </optgroup>
        </select>
        <span className={nafOptional}>The application's language follows the selected profile.</span>
      </Field>

      <BasicsFields value={form} onChange={onChange} />

      <CheckboxField
        label="Override profile summary for this application"
        checked={form.hasSummaryOverride}
        onChange={(hasSummaryOverride) => onChange({ hasSummaryOverride })}
      />
      {form.hasSummaryOverride && (
        <Field label="Profile summary override" hint="(replaces the profile's summary on this application only)">
          <AutoTextarea className={nafTextarea} value={form.summaryOverride} onChange={(e) => onChange({ summaryOverride: e.target.value })} />
        </Field>
      )}

      <Field label="Featured projects">
        <FeaturedProjectsPicker projects={profile.projects} featuredIds={form.featuredIds} onChange={(featuredIds) => onChange({ featuredIds })} />
      </Field>

      <CheckboxField
        label="Override skill groups for this application"
        checked={form.hasSkillGroupsOverride}
        onChange={(hasSkillGroupsOverride) => onChange({ hasSkillGroupsOverride })}
      />
      {form.hasSkillGroupsOverride && (
        <Field label="Skill groups override" hint="(replaces the profile's skill groups on this application only)">
          <div className="flex gap-2">
            <button className={nafAddBtn} onClick={onImportSkillGroups}>Import from JSON</button>
            <ExportSkillGroupsButton skillGroups={form.skillGroupsOverride} />
          </div>
          <SkillGroupsEditor skillGroups={form.skillGroupsOverride} onChange={(skillGroupsOverride) => onChange({ skillGroupsOverride })} />
        </Field>
      )}

      <CheckboxField label="Include cover letter" checked={form.hasCoverLetter} onChange={(hasCoverLetter) => onChange({ hasCoverLetter })} />
      {form.hasCoverLetter && (
        <>
          <div className={nafRow}>
            <Field label="Cover letter date">
              <input type="date" className={nafInput} value={form.dateISO} onChange={(e) => onChange({ dateISO: e.target.value })} />
            </Field>
            <Field label="Subject role">
              <input className={nafInput} placeholder="defaults to Role" value={form.subjectRole} onChange={(e) => onChange({ subjectRole: e.target.value })} />
            </Field>
          </div>

          <div className={nafRow}>
            <Field label="Recipient org">
              <input className={nafInput} value={form.recipientOrg} onChange={(e) => onChange({ recipientOrg: e.target.value })} />
            </Field>
            <Field label="Recipient name" hint="(optional)">
              <input
                className={nafInput}
                placeholder="defaults to Hiring Team"
                value={form.recipientName}
                onChange={(e) => onChange({ recipientName: e.target.value })}
              />
            </Field>
          </div>

          <CoverLetterParagraphs paragraphs={form.paragraphs} onChange={(paragraphs) => onChange({ paragraphs })} />

          <Field label="Closing" hint="(optional, shown above your signature)">
            <input
              className={nafInput}
              placeholder={`defaults to ${DEFAULT_CLOSINGS[form.language]}`}
              value={form.closing}
              onChange={(e) => onChange({ closing: e.target.value })}
            />
          </Field>
        </>
      )}
    </>
  );
}
