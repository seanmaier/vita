# API-Tokens rotieren – Design

## Absicht

Ein API-Token soll einen neuen geheimen Wert bekommen können, ohne es zu revoken und
unter gleichem Namen und Scope neu anzulegen. Ein Klick (bzw. ein CLI-Befehl) ersetzt
das bisherige Vorgehen „revoke + create“.

## Ziele / Nicht-Ziele

- Ziel: Rotieren in der Account-Seite, über die Session-API und in der CLI.
- Ziel: Name, Scope und Position in der Liste bleiben erhalten; zählt nicht gegen das 20-Token-Limit.
- Nicht-Ziel: Übergangsfrist für das alte Token (bewusst verworfen, s. Ansätze).
- Nicht-Ziel: Scope oder Name beim Rotieren ändern.
- Anti-Ziel: Ein Token darf sich nicht selbst (oder andere) rotieren – nur Session-Cookie, wie create/revoke.

## Ansätze

1. **Sofort ungültig (gewählt):** `token_hash` der bestehenden Zeile wird in einem
   UPDATE ersetzt. Das alte Token ist ab sofort ungültig. Kein Schema-Change.
2. Übergangsfrist: altes Token gilt noch z. B. 24 h weiter (`previous_token_hash`,
   `previous_expires_at` + Migration). Verworfen: mehr Komplexität; der Nutzer hat
   Variante 1 gewählt.

## Umsetzung

- `server/auth.ts`: `rotateApiToken(userId, name)` → `{ ok: true, token } | { ok: false, status: 404, error }`.
  Erzeugt ein neues `jat_…`-Token, `UPDATE api_tokens SET token_hash = ?, last_used_at = NULL
  WHERE user_id = ? AND name = ?`. Scope bleibt unverändert – auch ein Worker-Scope eines
  Nutzers, der kein Admin mehr ist (konsistent mit „bestehende Tokens laufen weiter“).
- `server/index.ts`: `POST /api/tokens/:name/rotate` mit `requireUser` (nur Cookie),
  Antwort `{ token }`, 404 wenn unbekannt; Log „API token rotated“ (ohne Token-Wert).
- `src/utils/api.ts`: `rotateApiToken(name): Promise<string>`.
- `src/components/ApiTokensSection.tsx`: Button „rotate“ neben „revoke“, mit
  Bestätigung („Das alte Token hört sofort auf zu funktionieren“). Danach erscheint der
  neue Wert in der bestehenden Einmal-Anzeige („Token "x" rotated. Copy it now…“).
- `server/cli.ts`: `token-rotate <username> <name>` druckt den neuen Wert einmal.
- Tests in `server/auth.test.ts` (altes Token ungültig, neues gültig, Scope erhalten,
  unbekannter Name → 404, fremder Nutzer kann nicht rotieren) und für die Route.
- README: Token-Abschnitt um Rotieren ergänzen.

## Daten

Kein Schema-, Format- oder Backup-Change. `created_at` bleibt (Anlage des Tokens),
`last_used_at` wird zurückgesetzt, damit sichtbar ist, ob der neue Wert schon benutzt wird
(meine Entscheidung).

## Dem Umsetzer überlassen

Genaue Texte/Styling des Buttons, Struktur der Tests.
