import { useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { applications } from '../data/applications';
import { getAllLocalApplications } from '../utils/localApplications';
import { useProfiles } from '../api/profiles';
import type { LanguageProfiles } from '../api/languageProfiles';
import { QueryState } from '../components/QueryState';
import type { DiffNames } from '../utils/versionDiff';
import type { ApplicationConfig, BaseProfile } from '#shared/types.ts';
import { useApplication } from '../hooks/useApplication';
import { useLeaveGuard } from '../hooks/useLeaveGuard';
import { isDemo } from '../demo/demoMode';
import { TrashedNotice } from '../components/TrashedNotice';
import { MobilePanelSwitch } from '../components/MobilePanelSwitch';
import { UnsavedChangesDialog } from '../components/UnsavedChangesDialog';
import { VersionHistoryDialog } from '../components/VersionHistoryDialog';
import { ImportSkillGroupsModal } from '../components/ImportSkillGroupsModal';
import { ChangeBar } from '../components/ChangeBar';
import { newAppBody, newAppForm, newAppPage } from '../styles/formStyles';
import { editFormToConfig, initialEditForm, type EditForm } from './editApplication/editForm';
import { EditFormFields } from './editApplication/EditFormFields';
import { EditHeader } from './editApplication/EditHeader';
import { EditPreviewPanel } from './editApplication/EditPreviewPanel';

// Inner component — staticApp is guaranteed to exist. onReload remounts it
// so the form picks up a config saved outside the form (the JSON editor).
function EditContent({
  staticApp,
  baseProfiles,
  languages,
  onReload,
}: {
  staticApp: ApplicationConfig;
  baseProfiles: BaseProfile[];
  languages: LanguageProfiles;
  onReload: () => void;
}) {
  const { app, save, reset, isDirty } = useApplication(staticApp);
  const navigate = useNavigate();
  const profileFor = (form: Pick<EditForm, 'baseProfileId' | 'language'>) =>
    (form.baseProfileId ? baseProfiles.find((p) => p.id === form.baseProfileId)?.profile : undefined) ??
    languages[form.language];

  const [form, setForm] = useState(() =>
    initialEditForm(app, profileFor({ baseProfileId: app.baseProfileId ?? '', language: app.language ?? 'en' })),
  );
  const update = (patch: Partial<EditForm>) => setForm((prev) => ({ ...prev, ...patch }));
  const profile = profileFor(form);
  const config = editFormToConfig(form, app, staticApp.id);

  const [mobilePanel, setMobilePanel] = useState<'form' | 'preview'>('form');
  const [historyOpen, setHistoryOpen] = useState(false);
  const [importSkillGroupsOpen, setImportSkillGroupsOpen] = useState(false);
  // Like a commit message: optionally says what this save changes.
  const [changeMessage, setChangeMessage] = useState('');

  // Snapshot of the form's initial values — never updated, since saving or
  // resetting always immediately navigates away rather than staying on the page.
  const [initialSnapshot] = useState(() => JSON.stringify(config));
  const isFormDirty = JSON.stringify(config) !== initialSnapshot;
  const { blocker, allowNextNavigation } = useLeaveGuard(isFormDirty);

  const handleSave = () => {
    save(config, changeMessage);
    allowNextNavigation();
    navigate(`/application/${staticApp.id}`);
  };

  const handleReset = () => {
    if (!confirm('Reset all edits and restore the original config?')) return;
    reset();
    allowNextNavigation();
    navigate(`/application/${staticApp.id}`);
  };

  // Readable names for the ids a version diff mentions. Projects come from
  // the profile the form currently shows; ids it doesn't know stay as they are.
  const historyNames = useMemo(
    (): DiffNames => ({
      baseProfile: (id) => baseProfiles.find((p) => p.id === id)?.name,
      project: (id) => profile.projects.find((p) => p.id === id)?.name,
    }),
    [baseProfiles, profile],
  );

  // A restore rewrites the stored config on the server: drop the form's
  // state and remount it from what's stored now.
  const handleRestored = () => {
    setHistoryOpen(false);
    onReload();
  };

  const previewApp: ApplicationConfig = { ...config, status: app.status };

  // Persists the JSON config, then remounts the form so it shows what was saved.
  const handleApplyJson = (edited: ApplicationConfig) => {
    const { status: _status, ...rest } = edited;
    save({ ...rest, id: staticApp.id }, changeMessage);
    onReload();
  };

  return (
    <div className={newAppPage}>
      <EditHeader
        appId={staticApp.id}
        company={staticApp.company}
        hasSavedEdits={isDirty}
        changeMessage={changeMessage}
        onChangeMessage={setChangeMessage}
        onSave={handleSave}
        onReset={handleReset}
        onOpenHistory={() => setHistoryOpen(true)}
      />

      <MobilePanelSwitch
        value={mobilePanel}
        onChange={setMobilePanel}
        options={[
          { value: 'form', label: 'edit' },
          { value: 'preview', label: 'preview / JSON' },
        ]}
      />

      <div className={newAppBody}>
        <div className={`${newAppForm} ${mobilePanel === 'form' ? '' : 'max-lg:hidden'}`}>
          <EditFormFields
            form={form}
            onChange={update}
            baseProfiles={baseProfiles}
            profile={profile}
            onImportSkillGroups={() => setImportSkillGroupsOpen(true)}
          />
          {!isDemo && (
            <ChangeBar
              appId={staticApp.id}
              message={changeMessage}
              onMessageChange={setChangeMessage}
              onSave={handleSave}
              onOpenHistory={() => setHistoryOpen(true)}
            />
          )}
        </div>

        <EditPreviewPanel
          application={previewApp}
          profile={profile}
          onApplyJson={handleApplyJson}
          className={mobilePanel === 'preview' ? '' : 'max-lg:hidden'}
        />
      </div>

      {blocker.state === 'blocked' && (
        <UnsavedChangesDialog
          onCancel={() => blocker.reset()}
          onDiscard={() => blocker.proceed()}
          onSave={() => {
            save(config, changeMessage);
            blocker.proceed();
          }}
        />
      )}

      {historyOpen && (
        <VersionHistoryDialog
          appId={staticApp.id}
          company={staticApp.company}
          names={historyNames}
          hasUnsavedEdits={isFormDirty}
          onRestored={handleRestored}
          onClose={() => setHistoryOpen(false)}
        />
      )}

      {importSkillGroupsOpen && (
        <ImportSkillGroupsModal
          application={previewApp}
          profile={profile}
          onApply={(skillGroupsOverride) => update({ skillGroupsOverride })}
          onClose={() => setImportSkillGroupsOpen(false)}
        />
      )}
    </div>
  );
}

export function EditApplicationPage() {
  const { id } = useParams<{ id: string }>();
  const staticApp = id ? [...applications, ...getAllLocalApplications()].find((a) => a.id === id) : undefined;
  const [formVersion, setFormVersion] = useState(0);
  const profiles = useProfiles();

  if (!staticApp) {
    return (
      <div className="py-20 px-10 font-mono text-ink-2 flex flex-col gap-4">
        <p>Application not found.</p>
        <Link className="text-accent" to="/">
          ← Back to dashboard
        </Link>
      </div>
    );
  }

  if (staticApp.deletedAt) return <TrashedNotice name={`${staticApp.company} – ${staticApp.role}`} />;

  // The form starts from the profiles as loaded; they don't change while it's open.
  return (
    <QueryState query={profiles}>
      {({ baseProfiles, languages }) => (
        <EditContent
          key={formVersion}
          staticApp={staticApp}
          baseProfiles={baseProfiles.filter((p) => !p.deletedAt)}
          languages={languages}
          onReload={() => setFormVersion((v) => v + 1)}
        />
      )}
    </QueryState>
  );
}
