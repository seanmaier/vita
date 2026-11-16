# Status State Machine Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make application status a server-enforced state machine with a recorded, undoable transition history that also supplies the applied/interview/decision dates, and make backup import additive.

**Architecture:** Pure rules in `src/domain/statusMachine.ts` and `src/domain/backupMerge.ts`, shared by server, app and demo. The server owns writes (`/api/v1/applications/:id/transitions*`, `/api/import`) and refuses status keys in `PUT /api/data`. The app calls those endpoints (or the pure functions in the demo) and shows only allowed next statuses.

**Tech Stack:** TypeScript, Hono, node:sqlite kv table, React 19, `node --test`.

**Spec:** `docs/superpowers/specs/2026-11-16-status-state-machine-design.md`

## Global Constraints

- Transition table, ghosted rule (`GHOSTED_AFTER_DAYS` = 30, derived, never stored) and `StatusTransition` shape exactly as in the spec.
- History key `status-history-<id>`; dates `YYYY-MM-DD`; derived dates formatted with `formatDateNumeric(iso, language)`.
- Never invent dates: unknown stays `null`.
- Code, comments and UI copy in English, like the repo.

## Review Focus

1. Stale tab: two tabs, one already moved the status → the other's transition must 409 via `expected`, not apply to the new state. (Task 3 test.)
2. Bundled/unknown application id (server has no entry) → first transition uses `expected` as the start, doesn't 404. (Task 3 test.)
3. Legacy `ghosted` stored value with no applied date → seeds as `sent` with `date: null`, current status `sent` (not ghosted). (Task 1 test.)
4. Import of a backup containing an id that exists only as a `status-<id>` row → skipped, not added. (Task 4 test.)
5. Undo on a history with only `drafting` → refused with a clear message, history unchanged. (Task 1 + Task 3 tests.)

---

### Task 1: Pure state machine

**Files:** Create `src/domain/statusMachine.ts`, `src/domain/statusMachine.test.ts`; modify `src/types.ts` (add `accepted`, `declined`; export `StatusTransition`, `StoredStatus = Exclude<ApplicationStatus,'ghosted'>`), `src/utils/parseApplicationConfig.ts` (STATUSES), `src/utils/status.ts` (labels/colours, move `GHOSTED_AFTER_DAYS`/`ghostedOn` users to the module), `src/styles/tokens.css` (`--status-accepted`, `--status-declined`), `package.json` test glob adds `"src/**/*.test.ts"`.

**Interfaces (Produces):**
- `TRANSITIONS: Record<StoredStatus, StoredStatus[]>`
- `allowedNext(status: ApplicationStatus): StoredStatus[]`
- `currentStatus(history: StatusTransition[], today: string): ApplicationStatus`
- `seedHistory(status: ApplicationStatus, dates: { appliedDate?: string; interviewDate?: string; finalDecisionDate?: string }): StatusTransition[]` (dates in any format `numericDateToIso` accepts)
- `appendTransition(history, to: StoredStatus, date: string, now: string): Result`
- `undoLast(history): Result`
- `setTransitionDate(history, index: number, date: string): Result`
- `validateHistory(value: unknown): Result`
- `derivedDates(history, language: AppLanguage): Pick<ApplicationConfig,'appliedDate'|'interviewDate'|'finalDecisionDate'>`
- `type Result = { ok: true; history: StatusTransition[] } | { ok: false; error: string }`

- [ ] Tests: each table edge allowed; `rejected→drafting`, `offer→rejected`, `sent→ready` refused; ghosted at 29 vs 30 days; `allowedNext('ghosted')` equals sent's; undo to initial then refused; seed for every legacy status with/without dates (`ghosted` → ends `sent`); derived dates (last sent, first interview, last decision); `validateHistory` rejects bad shape, non-drafting start, illegal step.
- [ ] Run `node --test src/domain/statusMachine.test.ts` → fail, implement, pass.
- [ ] `npm run build` passes; commit `feat(status): add the application status state machine`.

### Task 2: Server reads, migration, seed, trash

**Files:** Modify `server/store.ts` (`KEYS.statusHistory`), `server/v1.ts` (`effectiveApplication` uses history via new `server/statusHistory.ts`), create `server/statusHistory.ts` (`readHistory(userId, appId, fallbackStatus?)`, `writeHistory`), `server/db.ts` `migrate()` calls `migrateStatusHistories()` (exported from `server/statusHistory.ts`, must not import v1), `server/seed.ts`, `server/trash.ts` (remove history key on purge). Test: `server/statusHistory.test.ts`.

**Interfaces:** Produces `readHistory(userId: number, appId: string, fallback?: ApplicationStatus): StatusTransition[] | null` (null = server knows nothing), `writeHistory(userId, appId, history)`, `migrateStatusHistories(): void`.

- [ ] Tests: GET application returns `status` from history and derived dates; legacy kv (status `rejected` + appliedDate) migrates; stored `ghosted` → `sent`; migration twice is a no-op; existing history untouched.
- [ ] Implement, `npm test` passes, commit `feat(status): derive status and dates from a stored history`.

### Task 3: Transition endpoints and write guards

**Files:** Modify `server/v1.ts` (routes, PATCH/POST field rules), `server/index.ts` (`PUT /api/data` refuses setting `status-`/`status-history-` keys). Test: `server/statusTransitions.test.ts`.

**Interfaces:** `POST /api/v1/applications/:id/transitions {to, date?, expected?}`, `DELETE …/transitions/last`, `PATCH …/transitions/:index {date}` → 200 effective application (plus `statusHistory` field in the response); 409 `{ error, from, allowed }`.

- [ ] Tests: allowed step 200; illegal 409 with `allowed`; stale `expected` 409; unknown id with `expected` works; undo; undo at initial 409; date edit, bad date 400; trashed 409; PATCH with `status` or `appliedDate` 400; POST with `appliedDate` 400; `/api/data` refusal tested through a small exported guard `refusedStorageKeys(keys)`.
- [ ] Implement, tests pass, commit `feat(api): change status only through recorded transitions`.

### Task 4: Additive backup import

**Files:** Create `src/domain/backupMerge.ts` + test; modify `src/utils/dataBackup.ts` (v3 export with `statusHistories`, parse v1–3), `server/index.ts` (`POST /api/import`, session only), `src/components/BackupModal.tsx` (call import, show added/skipped, new copy).

**Interfaces:** `mergeBackup(current: Record<string,string>, backup: DataBackup, now: string): { ok: true; set: Record<string,string>; added: string[]; skipped: string[]; addedProfiles: string[] } | { ok: false; error: string }`.

- [ ] Tests: new app added with history; existing id (list, override, status row or history) skipped; v2 status seeded; invalid v3 history → error; profiles added only when new; list created when absent.
- [ ] Implement, tests pass, commit `feat(backup): add missing data on import instead of replacing it`.

### Task 5: App UI

**Files:** Create `src/utils/statusTransitions.ts` (`transition(appId, to, expected)`, `undo(appId)`, `changeDate(appId, index, date)`, `historyFor(app)`), `storage.setLocal`; modify `src/hooks/useApplicationStatus.ts`, `src/pages/DashboardPage.tsx`, `src/components/dashboard/ApplicationCard.tsx`, `src/pages/ApplicationPage.tsx`, `src/components/ApplicationTimeline.tsx`, `src/pages/EditApplicationPage.tsx`; delete `src/utils/autoStatusDates.ts`.

- [ ] Selects show current + `allowedNext` + "undo last step"; errors surface via `alert`. Date inputs removed; derived dates displayed and sortable. Timeline lists transitions with inline date edit.
- [ ] `npm run build`, `npm run lint`, `npm test` pass; manual check in `npm run dev:all`; commit `feat(status): pick only allowed next statuses and edit dates on the timeline`.

### Task 6: Docs and skill references

**Files:** `.claude/skills/bewerbung/SKILL.md` (field list: dates derived/read-only, status via transitions endpoint), README/API docs if they list fields.

- [ ] Update, commit `docs: describe status transitions for API clients`.
