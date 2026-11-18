# API-Token-Rotation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ein API-Token bekommt per Klick/CLI einen neuen geheimen Wert; Name und Scope bleiben, das alte Token ist sofort ungültig.

**Architecture:** `rotateApiToken` in `server/auth.ts` ersetzt `token_hash` der bestehenden Zeile per UPDATE. Eine Cookie-only-Route, ein Client-Helper, ein Button und ein CLI-Befehl nutzen es.

**Tech Stack:** Node (node:test, node:sqlite), Hono, React, TypeScript.

**Spec:** `docs/superpowers/specs/2026-11-18-api-token-rotation-design.md`

## Global Constraints

- Kein Schema-Change; nur `token_hash` und `last_used_at = NULL` werden geändert, `created_at` und `scope` bleiben.
- Neues Token mit Präfix `jat_` und `randomBytes(32).toString('base64url')` – wie `createApiToken`.
- Route nur mit `requireUser` (Session-Cookie), nie mit Bearer-Token.
- Token-Werte niemals loggen.

## Review Focus

- Name eines anderen Nutzers → kein Rotieren (404), dessen Token bleibt gültig. (Test in Task 1)
- Unbekannter Name → 404 / CLI-Fehler, keine Zeile verändert. (Test in Task 1)
- Worker-Scope bleibt nach Rotation erhalten, auch wenn der Nutzer kein Admin ist. (Test in Task 1)
- Token-Namen mit Sonderzeichen (Leerzeichen, `/`) in der URL → `encodeURIComponent` im Client. (Task 2, manuell)
- Rotieren eines Tokens, dessen Wert gerade angezeigt wird → Anzeige zeigt danach den neuen Wert. (Task 2, manuell)

---

### Task 1: `rotateApiToken` im Server, Route und CLI

**Files:**
- Modify: `server/auth.ts` (nach `revokeApiToken`)
- Modify: `server/index.ts` (nach `app.delete('/api/tokens/:name', …)`)
- Modify: `server/cli.ts` (Kopfkommentar, neuer `case 'token-rotate'`, Usage-Text)
- Test: `server/auth.test.ts`

**Interfaces:**
- Produces: `export function rotateApiToken(userId: number, name: string): CreateApiTokenResult` – `{ ok: true, token }` oder `{ ok: false, status: 404, error: 'No such token.' }`.
- Produces: `POST /api/tokens/:name/rotate` → `200 { token: string }` bzw. `404 { error }`.

- [ ] **Step 1: Failing tests in `server/auth.test.ts`**

```ts
test('rotating a token replaces its secret but keeps name and scope', () => {
  const user = createTestUser();
  const created = createApiToken(user.id, 'worker', 'inbound:deliver');
  assert.ok(created.ok);
  getApiToken(created.token);
  const rotated = rotateApiToken(user.id, 'worker');
  assert.ok(rotated.ok);
  assert.notEqual(rotated.token, created.token);
  assert.ok(rotated.token.startsWith('jat_'));
  assert.equal(getApiToken(created.token), null);
  assert.equal(getApiToken(rotated.token)?.scope, 'inbound:deliver');
  const [info] = listApiTokens(user.id);
  assert.equal(info.name, 'worker');
  assert.equal(listApiTokens(user.id).length, 1);
});

test('rotating resets last use', () => {
  const user = createTestUser();
  const created = createApiToken(user.id, 'used');
  assert.ok(created.ok);
  getApiToken(created.token);
  assert.ok(rotateApiToken(user.id, 'used').ok);
  assert.equal(listApiTokens(user.id)[0].last_used_at, null);
});

test('rotating an unknown or foreign token fails and changes nothing', () => {
  const owner = createTestUser();
  const other = createTestUser();
  const created = createApiToken(owner.id, 'mine');
  assert.ok(created.ok);
  assert.deepEqual(rotateApiToken(other.id, 'mine'), { ok: false, status: 404, error: 'No such token.' });
  assert.deepEqual(rotateApiToken(owner.id, 'missing'), { ok: false, status: 404, error: 'No such token.' });
  assert.equal(getApiToken(created.token)?.user.id, owner.id);
});
```

- [ ] **Step 2: `npm test` → FAIL (`rotateApiToken` nicht exportiert)**

- [ ] **Step 3: `rotateApiToken` implementieren**; Token-Erzeugung mit `createApiToken` über einen kleinen Helper `newApiToken()` teilen.

- [ ] **Step 4: Route** `app.post('/api/tokens/:name/rotate', requireUser, …)` – 404 mit `result.error`, sonst `log.info('API token rotated', { user, token: name })` und `c.json({ token })`.

- [ ] **Step 5: CLI** `token-rotate <username> <name>`: Usage-Fehler ohne Argumente, `fail` mit `"<user>" has no token named "<name>".` bei 404, sonst `Rotated API token "<name>" for "<user>". The new token is shown only this once:\n<token>`.

- [ ] **Step 6: `npm test`, `npm run lint`, `npx tsc -b` → alles grün**

- [ ] **Step 7: Commit** `feat(auth): rotate API tokens without revoking them`

### Task 2: Account-Seite und Doku

**Files:**
- Modify: `src/utils/api.ts` (nach `revokeApiToken`)
- Modify: `src/components/ApiTokensSection.tsx`
- Modify: `README.md` (CLI-Zeile ~99, API-Token-Abschnitt ~126)

**Interfaces:**
- Consumes: `POST /api/tokens/:name/rotate` aus Task 1.
- Produces: `export async function rotateApiToken(name: string): Promise<string>` (Fehlertext `'Rotating the token failed'`).

- [ ] **Step 1: Client-Helper** wie `createApiToken`, URL mit `encodeURIComponent(name)`.
- [ ] **Step 2: Button „rotate“** neben „revoke“ (gleiche Optik, Buttons in einem `flex gap-2`-Wrapper). Bestätigung: `Rotate the token "<name>"? The current value stops working immediately; you'll get a new one to copy.` Danach `setCreated({ name, token, rotated: true })`, `setCopied(false)`, `load()`.
- [ ] **Step 3: Einmal-Anzeige** zeigt `Token "<name>" rotated. Copy it now: it won't be shown again.` statt „created“, wenn `rotated`.
- [ ] **Step 4: README** – `token-rotate` in der CLI-Zeile ergänzen; im API-Token-Abschnitt ein Satz: Token lässt sich auf der Account-Seite rotieren, das alte wird sofort ungültig.
- [ ] **Step 5: `npm run lint`, `npx tsc -b`, `npm test` → grün; manuell in der App: rotieren, alter Wert → 401, neuer Wert → 200.**
- [ ] **Step 6: Commit** `feat(account): add a rotate button for API tokens`
