// Where the app's data comes from: the server for a logged-in user, or this
// browser tab for the demo (and for component tests). Each resource's hooks
// (e.g. useAllBaseProfiles in ./baseProfiles.ts) go through whichever backend
// the DataBackendProvider above them holds.
import { createContext, useContext } from 'react';
import type { BaseProfile } from '#shared/types.ts';
import { STORAGE_KEYS } from '#shared/storageKeys.ts';
import { client, errorFrom } from '../utils/apiClient';
import { storage } from '../utils/storage';

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

export interface DataBackend {
  baseProfiles: BaseProfilesBackend;
}

// ---- Server -----------------------------------------------------------------------

/** The parsed body of a successful response, or an error with the server's message. */
async function ok<T>(
  request: Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>,
  failure: string,
): Promise<T> {
  const res = await request;
  if (!res.ok) throw await errorFrom(res, failure);
  return (await res.json()) as T;
}

const routes = client.api['base-profiles'];
const param = (id: string) => ({ param: { id: encodeURIComponent(id) } });

export const serverBackend: DataBackend = {
  baseProfiles: {
    list: () => ok(routes.$get(), 'Loading the base profiles failed'),
    seed: (defaults) => ok(routes.seed.$post({ json: defaults }), 'Setting up the base profiles failed'),
    save: (profile) =>
      ok(routes[':id'].$put({ ...param(profile.id), json: profile }), 'Saving the base profile failed'),
    trash: (id) => ok(routes[':id'].trash.$post(param(id)), 'Moving the base profile to the trash failed'),
    restore: (id) => ok(routes[':id'].restore.$post(param(id)), 'Restoring the base profile failed'),
    remove: (id) => ok(routes[':id'].$delete(param(id)), 'Deleting the base profile failed'),
  },
};

// ---- This browser tab ---------------------------------------------------------------
// The demo keeps everything in the tab (src/utils/storage.ts, written to
// sessionStorage), with the same behaviour as the server routes.

function readList(): BaseProfile[] | null {
  try {
    const raw = storage.getItem(STORAGE_KEYS.baseProfiles);
    return raw ? (JSON.parse(raw) as BaseProfile[]) : null;
  } catch {
    return null;
  }
}

function changeList(change: (list: BaseProfile[]) => BaseProfile[] | null): Promise<BaseProfile[]> {
  const next = change(readList() ?? []);
  if (!next) return Promise.reject(new Error('No such base profile.'));
  storage.setItem(STORAGE_KEYS.baseProfiles, JSON.stringify(next));
  return Promise.resolve(next);
}

const known = (list: BaseProfile[], id: string) => list.some((p) => p.id === id);

export const localBackend: DataBackend = {
  baseProfiles: {
    list: () => Promise.resolve(readList()),
    seed: (defaults) => {
      const current = readList();
      return current ? Promise.resolve(current) : changeList(() => defaults);
    },
    save: (profile) =>
      changeList((list) =>
        known(list, profile.id) ? list.map((p) => (p.id === profile.id ? profile : p)) : [...list, profile],
      ),
    trash: (id) => {
      const deletedAt = new Date().toISOString();
      return changeList((list) => (known(list, id) ? list.map((p) => (p.id === id ? { ...p, deletedAt } : p)) : null));
    },
    restore: (id) =>
      changeList((list) =>
        known(list, id)
          ? list.map((p) => {
              if (p.id !== id) return p;
              const { deletedAt: _deletedAt, ...rest } = p;
              return rest;
            })
          : null,
      ),
    remove: (id) => changeList((list) => (known(list, id) ? list.filter((p) => p.id !== id) : null)),
  },
};

const BackendContext = createContext<DataBackend>(serverBackend);

export const DataBackendProvider = BackendContext.Provider;

export function useBackend(): DataBackend {
  return useContext(BackendContext);
}
