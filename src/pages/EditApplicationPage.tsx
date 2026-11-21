import { useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useApplications, type AppRecord } from '../api/applications';
import { combine } from '../api/combine';
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

// Inner component — the application exists. onReload remounts it
// so the form picks up a config saved outside the form (the JSON editor).
function EditContent({
  record,
  baseProfiles,
  languages,
  onReload,
}: {
  record: AppRecord;
  baseProfiles: BaseProfile[];
  languages: LanguageProfiles;
  onReload: () => void;
}) {
  const { app, save, reset, isDirty, isSaving } = useApplication(record);
  const staticApp = record.app;
  const showError = (e: Error) => alert(e.message);
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

  const leave = () => {
    allowNextNavigation();
    navigate(`/application/${staticApp.id}`);
  };

  const handleSave = () => {
    if (isSaving) return;
    save(config, changeMessage, { onSuccess: leave, onError: showError });
  };

  const handleReset = () => {
    if (!confirm('Reset all edits and restore the original config?')) return;
    reset({ onSuccess: leave, onError: showError });
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
    save({ ...rest, id: staticApp.id }, changeMessage, { onSuccess: onReload, onError: showError });
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
            save(config, changeMessage, { onSuccess: () => blocker.proceed(), onError: showError });
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
  const [formVersion, setFormVersion] = useState(0);
  const query = combine({ records: useApplications(), profiles: useProfiles() });

  // The form starts from the data as loaded; a later refetch doesn't reset it.
  return (
    <QueryState query={query}>
      {({ records, profiles: { baseProfiles, languages } }) => {
        const record = id ? records.find((r) => r.app.id === id) : undefined;
        if (!record) {
          return (
            <div className="py-20 px-10 font-mono text-ink-2 flex flex-col gap-4">
              <p>Application not found.</p>
              <Link className="text-accent" to="/">
                ← Back to dashboard
              </Link>
            </div>
          );
        }
        const { app } = record;
        if (app.deletedAt) return <TrashedNotice name={`${app.company} – ${app.role}`} />;
        return (
          <EditContent
            key={formVersion}
            record={record}
            baseProfiles={baseProfiles.filter((p) => !p.deletedAt)}
            languages={languages}
            onReload={() => setFormVersion((v) => v + 1)}
          />
        );
      }}
    </QueryState>
  );
}
