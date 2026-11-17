# Job fit and evaluated jobs — design

Date: 2026-11-16 · Branch: `feat/job-fit` (based on `feat/status-state-machine`, PR #65)

## Goal

A job check by `/stellencheck` ends up in the app instead of a Markdown table:
every checked job becomes an application with its fit score, also the ones the
user doesn't apply to. That way checked jobs are visible in one place, a job is
never checked or applied to twice by accident, and the fit can be compared with
what actually happened (calibration).

Success means:

- `/stellencheck` stores each result as an application in status `evaluated`
  with a `fit`; declining it moves it to `skipped`.
- `/bewerbung` continues an evaluated application instead of creating a second
  one.
- The dashboard shows the fit as a badge, sorts by it, and keeps skipped jobs out
  of the way.
- The "Bewertete Stellen" table in `priorities` is no longer written.

## Decisions (made without a separate round of questions)

1. **Two new statuses.** `evaluated` (checked, no decision yet) and `skipped`
   (decided not to apply). Transitions: `evaluated → drafting | skipped`;
   `skipped` is terminal (left by undo, like the other terminal statuses). A
   status history may now start with `drafting` or `evaluated`.
2. **`fit` is an optional application field**, part of the content like `url`:

   ```ts
   interface JobFit {
     score: number;          // 0–100, the computed fit
     cappedScore?: number;   // 0–100, when a cap from priorities applied
     recommendation: 'apply' | 'apply-if' | 'unlikely' | 'exclude';
     reason: string;         // the one-sentence main reason (and the condition for apply-if)
     evaluatedAt: string;    // ISO timestamp
   }
   ```

   The effective score is `cappedScore ?? score`. The criteria breakdown stays in
   the notes; it is only read once.
3. **Creating as evaluated.** `POST /api/v1/applications` accepts `status:
   "evaluated"` as the only alternative to the default `drafting`.
4. **Dashboard.** A fit badge (`NN %`, coloured by recommendation) in the row
   and the card, sortable as `fit`. Skipped applications are hidden unless the
   status filter is set to `skipped`. Stats ("total" etc.) count neither
   evaluated nor skipped ones, since they aren't applications yet.
5. **Skills.** `/stellencheck` looks for an existing application with the same
   URL (or company and role) first and updates its `fit` instead of creating a
   duplicate; otherwise it creates one in `evaluated`. Saving the check needs no
   extra confirmation (it replaces the log line it wrote before); moving to
   `skipped` happens when the user says they won't apply. Calibration reads
   fit and status from the API. `/bewerbung` reuses an evaluated application
   (PATCH the content, transition to `drafting`).

## Data migration

**Data migration: not needed for stored data.** The new statuses and the `fit`
field are additions: existing histories, applications and backups stay valid,
and nothing is converted. The Markdown table in the user's `priorities`
document is left as it is; importing its rows as evaluated applications is
offered to the user as a one-off, not done by the code. Backups that contain
`evaluated`/`skipped` histories can't be imported into the version before this
change (it would reject the unknown statuses); that's acceptable, since there is
no reason to go back.

## Testing

- State machine: new transitions, a history starting with `evaluated`, seeding
  for `evaluated`/`skipped`, validation.
- Config validation of `fit` (range, recommendation, required fields).
- API: create in `evaluated` with `fit`, refuse other initial statuses,
  `evaluated → skipped`, `evaluated → drafting`, PATCH `fit`.
- Stats exclude evaluated/skipped; build, lint; a look at the dashboard.
