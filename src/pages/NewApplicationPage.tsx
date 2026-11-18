import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type { AppLanguage, BaseProfile } from '../types';
import { LANG_FLAGS, LANGUAGE_LABELS } from '../utils/language';
import { getProfile } from '../data/profiles';
import { getBaseProfiles } from '../utils/baseProfiles';
import { saveLocalApplication } from '../utils/localApplications';
import { FeaturedProjectsPicker } from '../components/FeaturedProjectsPicker';
import { MobilePanelSwitch } from '../components/MobilePanelSwitch';
import { BasicsFields } from '../components/applicationForm/BasicsFields';
import { CoverLetterParagraphs } from '../components/applicationForm/CoverLetterParagraphs';
import { CheckboxField, Field } from '../components/applicationForm/fields';
import { editSaveBtn, nafInput, nafOptional, nafRow, newAppBody, newAppForm, newAppPage } from '../styles/formStyles';
import { ChooseBaseProfileScreen, NewApplicationHeader } from './newApplication/ChooseBaseProfileScreen';
import { JsonPreviewPanel } from './newApplication/JsonPreviewPanel';
import { newApplicationConfig, type NewApplicationForm } from './newApplication/newApplicationConfig';

export function NewApplicationPage() {
  const navigate = useNavigate();
  const [baseProfiles] = useState(() => getBaseProfiles());
  const [step, setStep] = useState<'select-profile' | 'form'>(baseProfiles.length > 0 ? 'select-profile' : 'form');
  const [mobilePanel, setMobilePanel] = useState<'form' | 'json'>('form');

  const [form, setForm] = useState<NewApplicationForm>(() => ({
    company: '',
    role: '',
    url: '',
    language: 'en',
    font: 'sans',
    baseProfileId: undefined,
    // Set once a base profile is chosen (or skipped) — except when there are
    // none to choose from, so the form shows right away and needs it now.
    featuredIds: baseProfiles.length === 0 ? getProfile('en').projects.map((p) => p.id) : [],
    hasCoverLetter: false,
    dateISO: '',
    subjectRole: '',
    paragraphs: [''],
  }));
  const update = (patch: Partial<NewApplicationForm>) => setForm((prev) => ({ ...prev, ...patch }));

  const selectedBaseProfile = form.baseProfileId ? baseProfiles.find((p) => p.id === form.baseProfileId) : undefined;
  const profile = selectedBaseProfile?.profile ?? getProfile(form.language);

  const chooseProfile = (bp: BaseProfile) => {
    update({ baseProfileId: bp.id, language: bp.language, featuredIds: bp.profile.projects.map((p) => p.id) });
    setStep('form');
  };

  // Without a base profile the application uses the chosen language's
  // default profile, so the language is picked here rather than in the form.
  const skipProfile = (language: AppLanguage) => {
    update({ baseProfileId: undefined, language, featuredIds: getProfile(language).projects.map((p) => p.id) });
    setStep('form');
  };

  if (step === 'select-profile') {
    return <ChooseBaseProfileScreen baseProfiles={baseProfiles} onChoose={chooseProfile} onSkip={skipProfile} />;
  }

  const config = newApplicationConfig(form);
  const canSave = form.company.trim() !== '' && form.role.trim() !== '';

  const save = () => {
    if (!canSave) return;
    saveLocalApplication(config);
    navigate(`/application/${config.id}`);
  };

  return (
    <div className={newAppPage}>
      <NewApplicationHeader />

      <MobilePanelSwitch
        value={mobilePanel}
        onChange={setMobilePanel}
        options={[{ value: 'form', label: 'form' }, { value: 'json', label: 'JSON' }]}
      />

      <div className={newAppBody}>
        <div className={`${newAppForm} ${mobilePanel === 'form' ? '' : 'max-lg:hidden'}`}>
          <Field label="Base profile">
            <div className="flex items-center gap-2.5">
              <span className="[font-family:var(--font-sans)] text-[13px] text-[color:var(--ink-invert)] flex items-center gap-1.5">
                {selectedBaseProfile ? (
                  <>
                    <span className="text-[13px] leading-none">{LANG_FLAGS[selectedBaseProfile.language]}</span>
                    {selectedBaseProfile.name}
                  </>
                ) : (
                  <span className={nafOptional}>{LANG_FLAGS[form.language]} {LANGUAGE_LABELS[form.language]} default</span>
                )}
              </span>
              <button
                className="[font-family:var(--font-mono)] text-[10.5px] bg-transparent text-[color:var(--ink-3)] border border-[color:var(--rule)] rounded px-2 py-[3px] cursor-pointer hover:text-[color:var(--accent)] hover:border-[color:var(--accent)]"
                onClick={() => setStep('select-profile')}
              >
                change
              </button>
            </div>
          </Field>

          <BasicsFields value={form} onChange={update} />

          <Field label="Featured projects">
            <FeaturedProjectsPicker projects={profile.projects} featuredIds={form.featuredIds} onChange={(featuredIds) => update({ featuredIds })} />
          </Field>

          <CheckboxField label="Include cover letter" checked={form.hasCoverLetter} onChange={(hasCoverLetter) => update({ hasCoverLetter })} />
          {form.hasCoverLetter && (
            <>
              <div className={nafRow}>
                <Field label="Cover letter date">
                  <input type="date" className={nafInput} value={form.dateISO} onChange={(e) => update({ dateISO: e.target.value })} />
                </Field>
                <Field label="Subject role" hint="(if different)">
                  <input className={nafInput} placeholder="defaults to Role" value={form.subjectRole} onChange={(e) => update({ subjectRole: e.target.value })} />
                </Field>
              </div>
              <CoverLetterParagraphs paragraphs={form.paragraphs} onChange={(paragraphs) => update({ paragraphs })} />
            </>
          )}

          <button
            className={editSaveBtn}
            style={{ opacity: canSave ? 1 : 0.4, cursor: canSave ? 'pointer' : 'not-allowed' }}
            onClick={save}
            disabled={!canSave}
          >
            Save application
          </button>
        </div>

        <JsonPreviewPanel config={config} className={mobilePanel === 'json' ? '' : 'max-lg:hidden'} />
      </div>
    </div>
  );
}
