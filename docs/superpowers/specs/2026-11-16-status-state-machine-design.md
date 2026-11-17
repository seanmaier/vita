# Application status as a state machine — design

Date: 2026-11-16 · Branch: `feat/status-state-machine`

## Goal

An application's status stops being a free choice. It moves along a fixed set of
transitions, every transition is recorded with a date, and the server enforces the
rules for the app and for API clients (assistant skills) alike. The recorded
history becomes the single source for the applied / interview / decision dates.

Success means:

- An invalid jump (e.g. `rejected → drafting`) is impossible from the app, the
  API and raw storage writes.
- Mistakes are fixable by undoing the last step, as often as needed.
- The dates can never contradict the status, and the date inputs disappear from
  the UI; dates are changed on the timeline entry they belong to.
- Restoring a backup adds what is missing instead of replacing the account.
- Existing data keeps working: it is migrated, old backups still import.

Out of scope (feature 2, own branch): the `fit` field, the `evaluated` /
`skipped` statuses and moving `/stellencheck` / `/bewerbung` to them.

## Statuses and transitions

`ApplicationStatus` gains `accepted` and `declined`. `ghosted` stays in the type
as a *derived display state* (below) and is never stored.

| From | To |
|---|---|
| `drafting` | `ready`, `sent`, `withdrawn` |
| `ready` | `drafting`, `sent`, `withdrawn` |
| `sent` (also shown as `ghosted`) | `interview`, `offer`, `rejected`, `withdrawn` |
| `interview` | `offer`, `rejected`, `withdrawn` |
| `offer` | `accepted`, `declined` |
| `rejected`, `withdrawn`, `accepted`, `declined` | — (terminal; left only by undo) |

`drafting ⇄ ready` is the only backward edge: before sending, going back to edit
is normal.

### Ghosted is derived

The current status is `ghosted` when the last recorded transition is `sent` and
its date is at least `GHOSTED_AFTER_DAYS` (30) days ago. Nothing is written when
that happens. A late answer is an ordinary `sent → interview / rejected / …`
transition, which ends the ghosted state. Storing an automatic transition was
rejected: it clashes with undo (the app would re-apply it on the next load) and
would make the server write on reads.

## Data model

New per-application kv key `status-history-<id>`, a JSON array, oldest first:

```ts
interface StatusTransition {
  to: Exclude<ApplicationStatus, 'ghosted'>;
  date: string | null;       // "YYYY-MM-DD", the business date; backdatable; null = unknown (migrated data only)
  recordedAt: string | null; // ISO timestamp of when it was entered; null for migrated entries
}
```

- The first entry is always `drafting`. The current stored status is the last
  entry's `to`.
- Dates shown as `appliedDate` / `interviewDate` / `finalDecisionDate` are
  derived: the last `sent` entry, the first `interview` entry, and the last entry
  whose status is one of `offer`, `rejected`, `withdrawn`, `accepted`,
  `declined`. They are formatted the way the fields are today
  (`formatDateNumeric` in the application's language), so the API, the PDF
  export, stats and the skills keep reading the same field names.

### Shared module `src/domain/statusMachine.ts`

Pure functions, no storage access, imported by the frontend, the server and the
demo:

- `TRANSITIONS`, `allowedNext(status)` (ghosted → sent's list),
  `canTransition(from, to)`
- `currentStatus(history, today)` — last `to`, or `ghosted` per the rule above
- `seedHistory(status, dates)` — builds a plausible history for data that has no
  history yet (see migration)
- `appendTransition(history, to, date, now)` → `{ ok, history } | { ok: false, error }`
- `undoLast(history)` — refuses to remove the initial `drafting` entry
- `setTransitionDate(history, index, date)`
- `validateHistory(value)` — shape plus "every step is an allowed transition";
  used for imports
- `derivedDates(history, language)`

### Tolerant reader

Wherever an application's status is needed (`effectiveApplication` on the
server, the dashboard and application page in the app), the history is
`status-history-<id>` if present, otherwise `seedHistory(...)` from the legacy
inputs: the `status-<id>` value, else the application's own `status`; dates from
its saved edits, else its stored/bundled entry. This covers applications the
server can't see (bundled from `private/applications/` in development) and
anything created before the migration ran.

## Writes

### API (session cookie or token, `/api/v1`)

- `POST /applications/:id/transitions` — body `{ to, date?, expected? }`.
  `date` defaults to today; `expected` is the status the caller believes is
  current and, when given, must match (409 otherwise, so a stale tab can't apply
  a step to a different state). If no history is stored yet it is materialised
  from the tolerant reader first; for an id the server knows nothing about,
  `expected` is used as the starting status. 409 on a disallowed transition with
  `{ error, from, allowed }`. Returns the effective application.
- `DELETE /applications/:id/transitions/last` — undo; 409 when only the initial
  entry is left.
- `PATCH /applications/:id/transitions/:index` — body `{ date: "YYYY-MM-DD" }`; a date is
  required. Changes when a step happened; the initial entry has no date to change.
- `PATCH /applications/:id` rejects `status`, `appliedDate`, `interviewDate`,
  `finalDecisionDate` with a 400 that points to the transitions endpoint. `POST
  /applications` ignores `status` (always `drafting`, as today) and rejects the
  date fields.
- Applications in the trash: all transition writes return 409, like other writes.

### Raw storage (`PUT /api/data`)

Setting a `status-<id>` or `status-history-<id>` key is refused with 400. Removing
them stays allowed: the app removes them when an application is deleted for
good.

### Frontend

A small client module (`src/utils/statusTransitions.ts`) performs a transition,
undo or date change: against the API normally, and locally with the same pure
functions in the demo (whose storage never reaches the server). After a
successful API call the returned history is written into the in-memory storage
cache without queuing a sync (new `storage.setLocal`).

UI changes:

- Status selects (dashboard rows/cards, application page) list only the
  current status and the allowed next ones, plus an "undo last step" entry when
  there is something to undo. A refused transition shows the server's message.
- The applied / interview / decision date inputs are removed from the dashboard
  (row and card layout) and the edit page. The dates are still shown (derived)
  and sortable.
- The timeline shows one entry per recorded transition (after the initial
  `drafting`), with its date or "date unknown", and lets the user change the date
  inline. The derived ghosted entry stays as today.
- New status colours `--status-accepted` and `--status-declined`.

## Backup import adds instead of replacing

Backups become `version: 3`: `statuses` is replaced by `statusHistories`
(`Record<id, StatusTransition[]>`). Version 1–3 files still import.

Import goes through a new session-only endpoint `POST /api/import` (the demo runs
the same merge locally). A shared pure function
`mergeBackup(current, backup)` decides the writes:

- An application from the backup is added only if its id isn't used yet (in the
  stored list, saved edits, a status or a history). Existing ones are skipped and
  never overwritten.
- Added applications get their history from `statusHistories` (validated; an
  invalid one fails the import with a message) or, for v1/v2, seeded from
  `statuses` plus their dates.
- Base profiles are added when their id is new; the profile list is created if
  the account has none yet. Legacy per-language profile overrides are set only
  where none exists.
- The result reports added and skipped ids, shown in the backup dialog.

The dialog's wording changes from "replaces everything" to "adds what's missing".

## Migration

**Data migration: needed.**

- Affected: every `status-<id>` row and the date fields in `app-config-<id>` /
  `local-apps`; stored `ghosted` values; backup files v1/v2; the server seed
  data; the demo data.
- Solution: an idempotent startup migration in `server/db.ts`' `migrate()`
  creates `status-history-<id>` for every application the server knows (entry
  in `local-apps` or a `status-<id>` row) that has none, via `seedHistory`.
  Stored `ghosted` becomes `sent` with the applied date. `status-<id>` rows and
  the old date fields are left in place for a rollback; the new code only reads
  them through the tolerant reader when no history exists. Old backups import
  through the seed path. The seed script writes a history; the demo relies on
  the tolerant reader.
- `seedHistory` builds the shortest plausible path: `drafting`, then `sent`
  (dated with the applied date) when the status is past sending, `interview`
  when there is an interview date or the status is `interview`, then the final
  status (dated with the decision date). `ready` and `withdrawn` before sending
  are direct steps from `drafting`. Unknown dates stay `null`; nothing is
  invented.
- Before deploying: take a database backup (`node server/backup.ts create`).
  Rollback: redeploy the old version; it still finds `status-<id>` and the date
  fields. Status changes made after the deploy would be missing there.

## Testing

`node:test` like the rest of the server:

- `statusMachine`: every allowed and a sample of refused transitions, ghosted
  derivation at 29/30 days, undo down to the initial entry, seeding for every
  legacy status with and without dates, derived dates, history validation.
- `mergeBackup`: add vs. skip, v2 seeding, invalid history.
- API: transition, undo, date change, 409s (disallowed, stale `expected`,
  trashed), PATCH rejecting status/dates, `PUT /api/data` refusing status keys,
  `/api/import`.
- Migration: an old-format database gets histories, `ghosted` becomes `sent`,
  running twice changes nothing.
- `npm run build` (type check) and `npm run lint`; a manual check in the running
  app of the dashboard select, undo, timeline date edit and backup import.
