# Fit Criteria Breakdown Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Store the per-criterion breakdown of a job rating on applications (`fit`) and on job leads, so scores can later be recomputed with other weights.

**Architecture:** One shared validator in `src/utils/fitCriteria.ts` checks a criteria list and its consistency with a score. `validateFit` (applications, JSON in `kv`) and `validatePatch` (leads, SQLite) both use it. Leads store `{ criteria, exclusion? }` as JSON in a new nullable column `rating`, added by `migrate()` for older databases. Both skills send the breakdown.

**Tech Stack:** TypeScript on Node (`node --test`, `node:sqlite`), Hono.

**Spec:** `docs/superpowers/specs/2026-11-17-fit-criteria-design.md`

## Global Constraints

- `FitCriterion = { name: string; weight: number; fulfilled: number }`; weight and fulfilled are integers 0–100.
- 1–20 criteria, unique non-empty (trimmed) names, weights sum to exactly 100.
- `sum = Math.round(Σ weight × fulfilled / 100)`.
- Application `fit.score` within ±1 of `sum`; lead `score` ≤ `sum + 1`.
- `exclusion`: non-empty string ≤ 500 chars, only together with `criteria`.
- Without `criteria`, every payload accepted today stays accepted (old data valid).
- Nothing is back-filled for old rows or old `fit` objects.

## Review Focus

- PATCH a lead with `criteria` but no `score` → 400 (the consistency check needs the score of the same request).
- PATCH a lead with `score: null` → `rating` is cleared too, so no orphan breakdown stays behind.
- `fulfilled: 50.5` or `weight: "20"` → rejected (integers only), not coerced.
- An old `fit` without `criteria` round-trips unchanged (no `criteria: undefined` key appears).
- A database from before this change (no `rating` column) starts and keeps its leads; `migrate()` twice is harmless.

---

### Task 1: Shared criteria validator and `JobFit` fields

**Files:**
- Create: `src/utils/fitCriteria.ts`, `src/utils/fitCriteria.test.ts`
- Modify: `src/types.ts:74-84` (`FitCriterion`, `JobFit.criteria?`, `JobFit.exclusion?`), `src/utils/parseApplicationConfig.ts:51-75`, `src/utils/parseApplicationConfig.test.ts`

**Interfaces:**
- Produces:
  - `export interface FitCriterion { name: string; weight: number; fulfilled: number }` in `src/types.ts`
  - `validateCriteria(value: unknown, field: string, errors: string[]): FitCriterion[] | undefined` — pushes messages prefixed with `field` (e.g. `"fit.criteria"`), returns trimmed copies or `undefined` on any error
  - `criteriaScore(criteria: FitCriterion[]): number` — the rounded `sum`
  - `validateExclusion(value: unknown, field: string, errors: string[]): string | undefined`

- [ ] **Step 1: Write failing tests** in `src/utils/fitCriteria.test.ts`:
  - `criteriaScore([{name:'A',weight:60,fulfilled:50},{name:'B',weight:40,fulfilled:75}])` → `60`
  - valid list returned trimmed (`' A '` → `'A'`)
  - errors for: empty list, 21 entries, duplicate name, empty name, weight sum 99, `fulfilled: 50.5`, `weight: '20'`, `fulfilled: 101`
  - `validateExclusion('')` and a 501-char string error; `'Freelance'` passes
- [ ] **Step 2:** `npm test` → new tests fail (module missing).
- [ ] **Step 3:** Implement the three functions in `src/utils/fitCriteria.ts`.
- [ ] **Step 4: Extend `validateFit`**, with tests first in `parseApplicationConfig.test.ts`:
  - fit with `criteria` (score 60 for the list above) and `exclusion` is kept as given
  - score 62 with that list → error mentioning `fit.score`; score 61 → ok
  - `exclusion` without `criteria` → error
  - existing test `a fit is kept as given` still passes and its result has no `criteria` key
  Then add the fields to `JobFit` and the validation (only set keys that are present).
- [ ] **Step 5:** `npm test` and `npm run typecheck` (or `npx tsc --noEmit`) pass.
- [ ] **Step 6: Commit** `feat(fit): store the per-criterion breakdown of a job check`

### Task 2: Breakdown on job leads, with migration

**Files:**
- Modify: `server/db.ts:52-68` (column `rating TEXT` in `CREATE TABLE`), `server/db.ts:92-99` (`migrate()`), `server/jobLeadsValidation.ts:49-90`, `server/jobLeads.ts` (row type, `toLead`, PATCH handler), `src/types.ts:172` (`JobLead.criteria?`, `JobLead.exclusion?`), `server/jobLeads.test.ts`
- Create: `server/jobLeads.migration.test.ts`

**Interfaces:**
- Consumes: `validateCriteria`, `validateExclusion`, `criteriaScore` from Task 1.
- Produces: `LeadPatch.criteria?: FitCriterion[] | null`, `LeadPatch.exclusion?: string | null`; `PATCH_FIELDS` gains `'criteria'`, `'exclusion'`; GET/PATCH responses carry `criteria`/`exclusion` only when stored.

- [ ] **Step 1: Write failing tests** in `server/jobLeads.test.ts`:
  - PATCH `{ status:'rated', score:60, verdict:'…', criteria:[…sum 60], exclusion:'Freelance' }` → 200; response and a later GET contain `criteria` and `exclusion`
  - score 62 with that list → 400; score 20 (capped) → 200
  - `criteria` without `score` → 400
  - after `{ score: null }` the lead has no `criteria`/`exclusion`
  - `{ criteria: null }` together with a score removes the breakdown
  - a lead rated without `criteria` returns no `criteria` key
- [ ] **Step 2:** `npm test` → those fail.
- [ ] **Step 3:** Implement: validation in `validatePatch` (criteria requires `score` in the body and must satisfy `score ≤ criteriaScore + 1`; exclusion requires criteria); the handler writes `rating = ?` as `JSON.stringify({ criteria, exclusion? })` or `NULL`, and `score: null` also sets `rating = NULL`; `toLead` parses `rating` and spreads its keys.
- [ ] **Step 4: Migration test** `server/jobLeads.migration.test.ts`, modelled on `server/db.migration.test.ts`: create an old `job_leads` table without `rating` (plus `users`), insert a rated lead, import `db.ts`, run `migrate()` twice, assert the column exists and the lead keeps `score`/`verdict`. Then add to `migrate()`: if `PRAGMA table_info(job_leads)` lacks `rating`, `ALTER TABLE job_leads ADD COLUMN rating TEXT`.
- [ ] **Step 5:** `npm test`, typecheck and `npm run lint` pass.
- [ ] **Step 6: Commit** `feat(job-leads): keep the criteria breakdown of a rating`

### Task 3: Skills send the breakdown

**Files:**
- Modify: `.claude/skills/stellencheck/SKILL.md` (step 5, the `fit` shape), `.claude/skills/stellenradar/SKILL.md` (step 5, the PATCH body)

- [ ] **Step 1:** In `/stellencheck` step 5 extend the `fit` shape with `"criteria": [{ "name": "<verbatim from priorities>", "weight": <int>, "fulfilled": <int 0–100> }]` and `"exclusion": "<only if one applied>"`; one sentence: names and weights exactly as in the criteria table of `priorities.md`, `score` must equal the rounded sum.
- [ ] **Step 2:** In `/stellenradar` step 5 add the same `criteria`/`exclusion` to the PATCH body, `score` is the score that counts (after a cap). Unreadable postings (estimated from title only) send no `criteria`.
- [ ] **Step 3:** Mark the `exclusion`/cap rule: with an exclusion the application `fit.score` stays the raw sum and `cappedScore` holds the capped value (≤ 20).
- [ ] **Step 4: Commit** `docs(skills): send the criteria breakdown with every rating`

### Task 4: Show the breakdown in the UI

Added after the plan review: the user asked that the feature is visible in the UI. Display only; editing weights stays step 2.

**Files:**
- Modify: `src/utils/fitCriteria.ts` (+ test), `src/pages/LeadsPage.tsx`, `src/components/dashboard/FitBadge.tsx`
- Create: `src/components/CriteriaBreakdown.tsx`

**Interfaces:**
- Consumes: `FitCriterion`, `JobFit.criteria/exclusion`, `JobLead.criteria/exclusion` from Tasks 1–2.
- Produces: `criterionPoints(c: FitCriterion): number` (= `Math.round(weight × fulfilled / 100)`), `breakdownText(criteria: FitCriterion[], exclusion?: string): string` (one line per criterion `"<name>: <fulfilled> % × <weight> = <points>"`, then `"Excluded: <exclusion>"` if set); `<CriteriaBreakdown criteria exclusion />`.

- [ ] **Step 1:** Tests in `src/utils/fitCriteria.test.ts` for `criterionPoints` (`{weight:15,fulfilled:50}` → 8) and `breakdownText` (exact lines incl. exclusion line); watch them fail.
- [ ] **Step 2:** Implement both.
- [ ] **Step 3:** `CriteriaBreakdown`: a `<details>` with summary "Breakdown" and a compact table (Criterion · Weight · Fulfilled · Points), exclusion as a line above it; renders nothing without criteria. Use it in `LeadCard` under the verdict.
- [ ] **Step 4:** `FitBadge` title: append `breakdownText` on new lines when `fit.criteria` is set (dashboard rows and cards).
- [ ] **Step 5:** `npm test`, typecheck, lint, `npm run build` pass; check in the running app that a lead with criteria shows the breakdown.
- [ ] **Step 6: Commit** `feat(leads): show the criteria breakdown of a rating`
