# Fit criteria breakdown — design

Date: 2026-11-17 · Branch: `feat/fit-criteria`

## Goal

`/stellencheck` and `/stellenradar` already rate every criterion from
`priorities` (weight × fulfilment) but only store the total. From now on they
store the per-criterion breakdown too, so a later UI can recompute scores with
changed weights or a different push threshold and preview the effect on real
jobs. This is step 1 of 2; step 2 (the UI) is a separate design.

Non-goals: no UI for editing weights or the threshold, no change to how scores
are displayed, no re-rating of old jobs.

Anti-goal: a breakdown that does not add up to the stored score. A later
recompute must reproduce today's numbers, otherwise the preview is misleading.

## Approaches

- **A — same breakdown in both places (chosen).** `fit` on applications and
  `job_leads` both get the list of criteria. Keeps the existing fields, the
  leads are where the push threshold applies.
- B — move leads to the full `fit` object. More uniform, but changes the leads
  API, the leads page and existing rows; too much for this step.
- C — applications only. Smallest, but misses the radar leads, which are the
  data the threshold preview needs.

## Design

**Shape** (shared type in `src/types.ts`):

```ts
interface FitCriterion {
  name: string;      // verbatim from the criteria table in `priorities`
  weight: number;    // integer 0–100, the weight used for this rating
  fulfilled: number; // integer 0–100, % fulfilled (50 for "unknown")
}
```

The weight is stored with each rating because weights change over time; the
name lets the UI match it to the current weights.

**Applications:** `JobFit` gets two optional fields, `criteria?: FitCriterion[]`
and `exclusion?: string` (the exclusion criterion that applied, if any).

**Leads:** `PATCH job-leads/<id>` accepts `criteria` (array or `null`) and
`exclusion` (string or `null`); `GET` returns them when set. Stored in one new
nullable column `rating TEXT` holding `{ criteria, exclusion? }` as JSON.
`criteria` must come with a `score` in the same request (the consistency
check needs it); `score: null` clears the breakdown as well.

**Validation** (one shared function used by both endpoints): 1–20 criteria,
unique non-empty names, integer weights and fulfilments 0–100, weights summing
to 100. Consistency with the score, where `sum = round(Σ weight × fulfilled / 100)`:

- application `fit.score` must be within ±1 of `sum`;
- lead `score` must be ≤ `sum + 1` (a lead's score is the score that counts,
  so it may be lower after an exclusion or a cap).

Without `criteria`, everything is accepted as today.

**Skills:** `/stellencheck` (step 5) and `/stellenradar` (step 5) send
`criteria` and, if one applied, `exclusion`, taken from the table they already
build. Names verbatim from `priorities`.

**Datenmigration:** nötig (nur additiv)
- Betroffen: SQLite table `job_leads` (new column); `fit` JSON in `kv`
  (new optional fields); file backups made by `server/backup.ts`.
- Lösung: `migrate()` adds the column if missing (same pattern as
  `api_tokens.scope`), so a restored older backup is upgraded on start. Old
  rows and old `fit` objects stay valid and simply have no breakdown; nothing
  is back-filled or invented.
- Vor dem Deploy: nothing special; rollback is safe because older code ignores
  the extra column and fields.

## Left to the builder

File placement of the shared validator, error message wording, tests (old-format
data included).
