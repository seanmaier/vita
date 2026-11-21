// The demo's data, which stays in the browser tab: an in-memory copy that
// src/api/localBackend.ts reads synchronously, with every write passed on to
// the backend set with setStorageBackend (the demo's sessionStorage). The
// component tests use it the same way. A logged-in user's data lives on the
// server and goes through src/api/backend.ts instead.

const data = new Map<string, string>();

type Backend = (set: Record<string, string>, remove: string[]) => unknown;
let save: Backend = () => {};

/** Where writes go, e.g. the demo's sessionStorage. */
export function setStorageBackend(backend: Backend): void {
  save = backend;
}

export function hydrate(entries: Record<string, string>): void {
  data.clear();
  Object.entries(entries).forEach(([k, v]) => data.set(k, v));
}

export const storage = {
  getItem(key: string): string | null {
    return data.get(key) ?? null;
  },
  setItem(key: string, value: string): void {
    data.set(key, value);
    save({ [key]: value }, []);
  },
  removeItem(key: string): void {
    data.delete(key);
    save({}, [key]);
  },
  keys(): string[] {
    return [...data.keys()];
  },
};
