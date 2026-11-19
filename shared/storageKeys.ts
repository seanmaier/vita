// Every key of a user's stored data: the rows of the server's kv table, which
// the browser keeps an in-memory copy of (src/utils/storage.ts). Frontend,
// server and backups all name keys through this file.
//
// Renaming a key orphans everything already stored under the old name, in the
// database and in backup files: that needs a migration (see /datenmigration).

/** The prefixes of the per-application and per-document keys, e.g. `app-config-<id>`. */
export const KEY_PREFIXES = {
  appConfig: 'app-config-',
  /** Legacy single status; read only when no history exists (see server/statusHistory.ts). */
  status: 'status-',
  statusHistory: 'status-history-',
  profileOverride: 'profile-override-',
  knowledge: 'knowledge-',
} as const;

export const STORAGE_KEYS = {
  /** The user's applications (ApplicationConfig[]), trashed ones included. */
  localApps: 'local-apps',
  /** The user's base profiles (BaseProfile[]), trashed ones included. */
  baseProfiles: 'base-profiles',
  /** Set once the guided tour was closed. */
  tourSeen: 'tour-seen',
  /** An application's saved edits, laid over its stored config. */
  appConfig: (appId: string) => `${KEY_PREFIXES.appConfig}${appId}`,
  status: (appId: string) => `${KEY_PREFIXES.status}${appId}`,
  /** An application's status history (StatusTransition[]). */
  statusHistory: (appId: string) => `${KEY_PREFIXES.statusHistory}${appId}`,
  /** Edits to a language's default profile. */
  profileOverride: (language: string) => `${KEY_PREFIXES.profileOverride}${language}`,
  /** A knowledge document's text (about-me, priorities). */
  knowledge: (doc: string) => `${KEY_PREFIXES.knowledge}${doc}`,
};
