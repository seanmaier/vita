// Where the app's data comes from: the server for a logged-in user (here), or
// this browser tab for the demo and component tests (./localBackend.ts). Each
// resource's hooks (e.g. useAllBaseProfiles in ./baseProfiles.ts) go through
// whichever backend the DataBackendProvider above them holds.
import { createContext, useContext } from 'react';
import type { AppLanguage, ApplicationConfig, BaseProfile, Profile, StatusTransition } from '#shared/types.ts';
import type { StoredApplication } from '../../server/routes/applications.ts';
import type { Settings } from '../../server/routes/settings.ts';
import { todayIso } from '#shared/utils/date.ts';
import { client, errorFrom } from '../utils/apiClient';
import { statusOf, type StatusAction } from '../utils/statusTransitions';

export type { Settings, StoredApplication };
export type StoredConfig = Omit<ApplicationConfig, 'status'>;

/** Every write answers with the whole list, trash included. */
export interface BaseProfilesBackend {
  /** Null until a list was ever stored. */
  list(): Promise<BaseProfile[] | null>;
  /** Stores `defaults` only if no list was ever stored; resolves to the stored list. */
  seed(defaults: BaseProfile[]): Promise<BaseProfile[]>;
  save(profile: BaseProfile): Promise<BaseProfile[]>;
  trash(id: string): Promise<BaseProfile[]>;
  restore(id: string): Promise<BaseProfile[]>;
  remove(id: string): Promise<BaseProfile[]>;
}

/** Edits to a language's default profile from before base profiles; only the languages that have one. */
export type ProfileOverrides = Partial<Record<AppLanguage, Profile>>;

export interface ProfileOverridesBackend {
  list(): Promise<ProfileOverrides>;
}

/** Every write except a status step answers with all applications, trash included. */
export interface ApplicationsBackend {
  list(): Promise<StoredApplication[]>;
  /** Adds the application to the list or replaces its entry. */
  save(config: ApplicationConfig): Promise<StoredApplication[]>;
  /** `message` says what changed, for the version history. */
  saveEdits(id: string, config: StoredConfig, message?: string): Promise<StoredApplication[]>;
  resetEdits(id: string): Promise<StoredApplication[]>;
  trash(id: string): Promise<StoredApplication[]>;
  restore(id: string): Promise<StoredApplication[]>;
  remove(id: string): Promise<StoredApplication[]>;
  /** Takes a status step from `history` (as the app shows it); resolves to the new history. */
  changeStatus(id: string, history: StatusTransition[], action: StatusAction): Promise<StatusTransition[]>;
  /** Changes when step `index` happened. */
  changeStepDate(id: string, history: StatusTransition[], index: number, date: string): Promise<StatusTransition[]>;
}

export interface SettingsBackend {
  get(): Promise<Settings>;
  /** Remembers that the guided tour was closed, so it doesn't open by itself again. */
  markTourSeen(): Promise<Settings>;
}

export interface DataBackend {
  applications: ApplicationsBackend;
  baseProfiles: BaseProfilesBackend;
  profileOverrides: ProfileOverridesBackend;
  settings: SettingsBackend;
}

// ---- Server -----------------------------------------------------------------------

/** The parsed body of a successful response, or an error with the server's message. */
async function ok<T>(
  request: Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>,
  failure: string,
): Promise<T> {
  const res = await request;
  // The session expired (e.g. in a tab left open): the login screen is the only way forward.
  if (res.status === 401) window.location.reload();
  if (!res.ok) throw await errorFrom(res, failure);
  return (await res.json()) as T;
}

const routes = client.api['base-profiles'];
const appRoutes = client.api.applications[':id'];
const transitions = client.api.v1.applications[':id'].transitions;
const param = (id: string) => ({ param: { id: encodeURIComponent(id) } });

/** The new history from a transitions answer. */
const historyFrom = (request: Parameters<typeof ok>[0]) =>
  ok<{ statusHistory: StatusTransition[] }>(request, 'Changing the status failed').then((r) => r.statusHistory);

export const serverBackend: DataBackend = {
  applications: {
    list: () => ok(client.api.applications.$get(), 'Loading the applications failed'),
    save: (config) => ok(appRoutes.$put({ ...param(config.id), json: config }), 'Saving the application failed'),
    saveEdits: (id, config, message) =>
      ok(
        appRoutes['saved-edits'].$put({ ...param(id), json: { config, ...(message && { message }) } }),
        'Saving your changes failed',
      ),
    resetEdits: (id) => ok(appRoutes['saved-edits'].$delete(param(id)), 'Resetting the application failed'),
    trash: (id) => ok(appRoutes.trash.$post(param(id)), 'Moving the application to the trash failed'),
    restore: (id) => ok(appRoutes.restore.$post(param(id)), 'Restoring the application failed'),
    remove: (id) => ok(appRoutes.$delete(param(id)), 'Deleting the application failed'),
    changeStatus: (id, history, action) =>
      historyFrom(
        action === 'undo'
          ? transitions.last.$delete(param(id))
          : transitions.$post({ ...param(id), json: { to: action, date: todayIso(), expected: statusOf(history) } }),
      ),
    changeStepDate: (id, _history, index, date) =>
      historyFrom(
        transitions[':index'].$patch({ param: { id: encodeURIComponent(id), index: String(index) }, json: { date } }),
      ),
  },
  baseProfiles: {
    list: () => ok(routes.$get(), 'Loading the base profiles failed'),
    seed: (defaults) => ok(routes.seed.$post({ json: defaults }), 'Setting up the base profiles failed'),
    save: (profile) =>
      ok(routes[':id'].$put({ ...param(profile.id), json: profile }), 'Saving the base profile failed'),
    trash: (id) => ok(routes[':id'].trash.$post(param(id)), 'Moving the base profile to the trash failed'),
    restore: (id) => ok(routes[':id'].restore.$post(param(id)), 'Restoring the base profile failed'),
    remove: (id) => ok(routes[':id'].$delete(param(id)), 'Deleting the base profile failed'),
  },
  profileOverrides: {
    list: () => ok(client.api['profile-overrides'].$get(), 'Loading the profiles failed'),
  },
  settings: {
    get: () => ok(client.api.settings.$get(), 'Loading the settings failed'),
    markTourSeen: () => ok(client.api.settings['tour-seen'].$put(), 'Saving the settings failed'),
  },
};

const BackendContext = createContext<DataBackend>(serverBackend);

export const DataBackendProvider = BackendContext.Provider;

export function useBackend(): DataBackend {
  return useContext(BackendContext);
}
