# Replacing the kv rows with tables

Status: approved. Step 1 is implemented (server/userData.ts). Decisions:
a backup before the deploy is the rollback for step 1 (no double writes);
step 2 uses TanStack Query; step 3 follows once step 1 has run in production.

## Problem

Everything a user edits lives in the `kv` table as the strings the browser
once kept in `localStorage`: `local-apps` (every application in one JSON
array), `base-profiles` (every base profile in one array), `app-config-<id>`,
`status-history-<id>`, `profile-override-<lang>`, `knowledge-<doc>`,
`tour-seen`. The frontend loads all of it after login (`GET /api/data`),
reads it synchronously, and writes changed keys back in batches
(`PUT /api/data`). `/api/v1` reads and writes the same rows for scripts and
the Claude skills.

This works, but:

- **Whole-list writes.** Saving one application rewrites the entire
  `local-apps` array. A tab with a stale copy overwrites what `/api/v1`
  changed meanwhile; this is only kept in check by refreshing on tab focus
  and by guards like `refusedStorageKeys`.
- **Two write paths** to the same data: raw keys from the browser,
  resources from `/api/v1`. Every rule (status only through transitions,
  trash, version history) has to be enforced on both.
- **No integrity in the database.** Ids, references (base profile of an
  application) and trash state are fields inside JSON strings; SQL can't
  query or constrain them.

Since `shared/storageKeys.ts` (this branch), the key names at least have one
definition. The steps below go further.

## Proposed target

| Table | Rows | Replaces |
|---|---|---|
| `applications` | `user_id, id, config JSON, saved_edits JSON NULL, deleted_at NULL` | `local-apps` entries + `app-config-<id>` |
| `status_transitions` | `user_id, app_id, position, to, date, recorded_at` | `status-history-<id>` (and legacy `status-<id>`) |
| `base_profiles` | `user_id, id, name, language, profile JSON, deleted_at NULL` | `base-profiles` entries |
| `profile_overrides` | `user_id, language, profile JSON` | `profile-override-<lang>` |
| `knowledge_docs` | `user_id, doc, content` | `knowledge-<doc>` |
| `user_settings` | `user_id, key, value` | `tour-seen` and future flags |

CV content (experience, projects, cover letter) stays JSON inside a column:
it is always read and written as a whole, and the Zod schemas already check
its shape. What becomes relational is what has identity or is queried:
applications, profiles, status steps, trash.

## Steps

Each step is a PR of its own and leaves the app working.

1. **Tables behind the existing API.** Create the tables and copy every
   user's kv rows into them in one transaction at startup (idempotent:
   skipped once a `kv_migrated_at` marker is set). `GET /api/data` builds
   the same key → value map from the tables, `PUT /api/data` maps each key
   to a row write, and `/api/v1` uses the tables directly. The frontend and
   backup files don't change. The kv rows stay untouched for one release as
   a fallback.
2. **Frontend per resource.** Move the frontend, one resource at a time
   (applications, base profiles, profile overrides), from the raw key sync
   to `/api/v1` calls (the typed client from refactor/hono-rpc-client), with
   TanStack Query for caching and refetching instead of the hand-written
   sync in `src/utils/storage.ts`. Each move deletes the matching key
   mapping from `/api/data`.
3. **Remove the adapter and the kv table**, once nothing reads it. Backups
   then export from the resources; the import keeps reading the old format.

## Datenmigration

**Datenmigration:** nötig (Schritt 1 und 3)
- Betroffen: alle `kv`-Zeilen jedes Nutzers in `/data/app.db`; Backup-Dateien
  bei Nutzern; offene Tabs mit altem Client während des Deploys; `/api/v1`-
  Konsumenten (Skills, Worker).
- Lösung: einmalige, idempotente Migration in einer Transaktion beim Start
  (Schritt 1), Test mit einer Datenbank im alten Format inkl. Altdaten
  (`status-<id>` ohne Historie, Bewerbungen ohne `app-config`). Backup-Format
  bleibt in Schritt 1 und 2 identisch; der Import liest auch nach Schritt 3
  alte Dateien. `/api/v1`-Antworten bleiben gleich.
- Vor dem Deploy: `sh vita-backup.sh create`. Rollback in Schritt 1: altes
  Image starten; es liest die unveränderten kv-Zeilen, verliert aber alles,
  was nach dem Deploy geschrieben wurde. Wer das vermeiden will, braucht für
  eine Release-Dauer Doppel-Schreiben (Tabellen + kv), was Schritt 1 etwa
  verdoppelt.

## Open decisions

1. Do it at all? Steps 1–3 are several days of work and touch all stored
   data; the benefit is fewer overwrite races and simpler rules, not new
   features. Stopping after `shared/storageKeys.ts` is a valid choice.
2. Rollback for step 1: plain backup before deploy (simple) or one release
   of double writes (safe, more code)?
3. Step 2: TanStack Query, or keep a small hand-written cache per resource?
