# Job-Alerts-Worker (vita-job-alerts)

Ein Cloudflare Email Worker, der Job-Alert-Mails aus Gmail übernimmt und als Leads an die Vita-App sendet.

## Was der Worker macht

Ein Gmail-Filter leitet Job-Alert-Mails (z. B. von LinkedIn) an `jobs@<alerts-domain>` weiter. Cloudflare Email Routing übergibt diese Mails an den Worker. Dieser prüft den Envelope-Absender: Er muss die eigene Gmail-Adresse sein (Punkte und `+`-Suffixe werden ignoriert, `googlemail.com` wird wie `gmail.com` behandelt). Danach wird der Alert-Absender bestimmt und die Stellen per `POST /api/v1/job-leads` an die App übergeben. Schlägt etwas fehl (unlesbare Mail, keine Stellen, App-Fehler), leitet der Worker die Mail an `OWNER_EMAIL` weiter und setzt den Header `X-Vita-Ingest-Error`.

In den Befehlen unten steht `<alerts-domain>` für die Empfangsdomain (z. B. `alerts.example.org`) und `<app-url>` für die Adresse der App (z. B. `https://vita.example.org`).

## Entwicklung

```sh
cd workers/job-alerts
npm ci
npm test
npx tsc --noEmit -p .
npx wrangler deploy --dry-run --outdir <tmp>
```

Die Test-Fixtures in `test/fixtures` sind synthetisch.

## Einrichtung

Die Schritte laufen über die CLI. Die Email-Routing-Befehle sind in wrangler 4.162 noch **open beta**.

### 1. Anmelden und Konto prüfen

```sh
npx wrangler login
npx wrangler whoami
```

### 2. App erreichbar machen

```sh
curl -s <app-url>/api/health
```

Erwartet: `{"ok":true}`. Kommt stattdessen eine Cloudflare-Access-Anmeldeseite, unter **Zero Trust → Access → Service Auth** einen Service Token anlegen. Dessen Werte werden später als `CF_ACCESS_CLIENT_ID` und `CF_ACCESS_CLIENT_SECRET` gesetzt.

### 3. Email Routing für die Subdomain aktivieren

```sh
npx wrangler email routing enable <alerts-domain>
npx wrangler email routing dns get <alerts-domain>
```

Akzeptiert `enable` die Subdomain nicht, sie im Dashboard unter **Email → Email Routing → Settings → Subdomains** hinzufügen. Die `dns get`-Ausgabe zeigt die von Cloudflare angelegten MX- und SPF-Einträge.

### 4. Private Zieladresse verifizieren

```sh
npx wrangler email routing addresses create <private-adresse>
```

Anschließend den Bestätigungslink in der Mail an `<private-adresse>` klicken. Prüfen mit:

```sh
npx wrangler email routing addresses list
```

### 5. Ingest-Token in der App erzeugen

Im App-Container ausführen:

```sh
node server/cli.ts token-add <username> job-alerts-worker --scope job-leads:ingest
```

Den ausgegebenen Token als `APP_TOKEN` hinterlegen (Schritt 6).

### 6. Worker deployen

```sh
cd workers/job-alerts
npm ci
npx wrangler secret put APP_URL     # <app-url>
npx wrangler secret put APP_TOKEN
npx wrangler secret put OWNER_GMAIL
npx wrangler secret put OWNER_EMAIL
# optional, nur wenn Schritt 2 einen Access-Service-Token nötig gemacht hat:
npx wrangler secret put CF_ACCESS_CLIENT_ID
npx wrangler secret put CF_ACCESS_CLIENT_SECRET
npm run deploy
```

Die Secrets und die App-Adresse stehen bewusst nicht in `wrangler.jsonc`, da das Repo öffentlich ist.

- `OWNER_GMAIL`: die Gmail-Adresse, von der die Alerts weitergeleitet werden.
- `OWNER_EMAIL`: die private Zieladresse aus Schritt 4. **Sie muss ein anderes Postfach sein als das Gmail-Konto.** Sonst können weitergeleitete Fehlerkopien erneut den Gmail-Filter treffen.

### 7. Routing-Regel anlegen

```sh
npx wrangler email routing rules create <alerts-domain> \
  --name "Job-Alerts an Vita" \
  --match-type literal --match-field to --match-value jobs@<alerts-domain> \
  --action-type worker --action-value vita-job-alerts
npx wrangler email routing rules list <alerts-domain>
```

### 8. Gmail einrichten (im Browser)

> **Warnung:** Die Prüfung des Envelope-Absenders ist keine Authentifizierung. Der SPF-Eintrag von gmail.com ist nur `softfail`, der Absender lässt sich also fälschen. Bevor der Gmail-Filter aktiviert wird, muss eine SPF-/`Authentication-Results`-Prüfung ergänzt werden, und zwar anhand der Header einer echten weitergeleiteten Mail (einmalig mit `wrangler tail` protokollieren). Bis dahin nur mit **deaktiviertem** Filter testen. `OWNER_EMAIL` muss außerdem ein eigenes Postfach sein (siehe oben).

1. Unter **Einstellungen → Weiterleitung und POP/IMAP** die Adresse `jobs@<alerts-domain>` als Weiterleitungsadresse hinzufügen. Die Bestätigungsmail von Google landet über den Worker bei `OWNER_EMAIL`. Der Worker leitet sie dort weiter. Den Bestätigungscode daraus eingeben.
2. Einen Filter anlegen:
   `from:(jobalerts-noreply@linkedin.com OR …)`
   Die Absender stammen aus den Fixtures. Aktion: **Weiterleiten an** `jobs@<alerts-domain>`.

### 9. Ende-zu-Ende prüfen

```sh
npm run tail
```

Eine Alert-Mail weiterleiten (oder den nächsten Alert abwarten). Im Log erscheint `job-alerts: ingested`. Die Leads prüfen:

```sh
node scripts/api.ts GET "job-leads?status=new"
```

(Vom Repo-Root aus.) Eine Mail von einer fremden Adresse an `jobs@<alerts-domain>` muss abgelehnt werden. Im Log erscheint dann `rejected`.

## Hinweis

Die Test-Fixtures sind synthetisch. Sobald die ersten echten Alerts angekommen sind, die Parser (`src/parsers.ts`) mit anonymisierten echten Mails prüfen und die Fixtures ergänzen.
