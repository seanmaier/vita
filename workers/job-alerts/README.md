# Job-Alerts-Worker (vita-job-alerts)

Ein Cloudflare Email Worker, der Job-Alert-Mails aus Gmail übernimmt und pro Nutzer an die Vita-App zustellt.

## Was der Worker macht

Jeder Nutzer bekommt auf der Account-Seite der App eine eigene Adresse (z. B. `jobs-k7x2@alerts.example.org`). Ein Gmail-Filter leitet Job-Alert-Mails (z. B. von LinkedIn) an diese Adresse weiter. Eine Catch-all-Regel in Cloudflare Email Routing übergibt alle Mails an der Subdomain an den Worker.

Der Worker kennt keine Nutzeradressen. Er parst die Mail und sendet sie per `POST /api/v1/inbound-mail` an die App. Der Body enthält `recipient` (Empfängeradresse), `envelopeFrom`, `kind` (`leads`, `confirmation` oder `failed`) sowie je nach Fall `subject`, `sender`, `detail` und `leads`. Die App ordnet die Empfängeradresse einem Nutzer zu und prüft, ob der Envelope-Absender zu dessen eingetragener Gmail-Adresse passt.

- 201: zugestellt.
- 400, 403, 404: Die App lehnt die Mail ab. Der Worker weist sie mit `not accepted` ab, ohne Wiederholung.
- Netzwerkfehler, 5xx, Weiterleitungen oder sonstige Antworten: Der Worker wiederholt einmal nach 2 s. Hilft das nicht, weist er die Mail mit `Vita is unavailable right now; please forward this mail again later` ab. Cloudflares `setReject` ist eine permanente Ablehnung: Gmail wiederholt nicht, der Absender erhält einen Bounce und muss die Mail später erneut weiterleiten. Nichts wird still verworfen.

Es wird nichts mehr weitergeleitet, daher ist keine verifizierte Zieladresse in Cloudflare nötig.

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

**Reihenfolge:** Zuerst die App deployen (mit dem Inbound-Endpoint #57 und dem Account-Seiten-Branch `feat/multi-user-alerts`), dann in der App den `inbound:deliver`-Token erzeugen (Schritt 4), erst danach den Worker deployen (Schritt 5). Der Worker stellt sonst an eine App zu, die den Endpoint noch nicht kennt. Die Empfangsdomain stellt die App über die Umgebungsvariable `INBOUND_DOMAIN` ein; ohne sie ist die Funktion in der App aus. Sie muss zur Domain passen, für die die Catch-all-Regel des Workers Mails annimmt.

In den Befehlen unten steht `<zone>` für die Cloudflare-Zone (z. B. `example.org`), `<alerts-domain>` für die Empfangsdomain, also den Wert von `INBOUND_DOMAIN` (z. B. `alerts.example.org`), und `<app-url>` für die Adresse der App (z. B. `https://vita.example.org`).

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

### 4. Token in der App erzeugen

Im App-Container ausführen:

```sh
node server/cli.ts token-add <admin> job-alerts-worker --scope inbound:deliver
```

Den ausgegebenen Token als `APP_TOKEN` hinterlegen (Schritt 5).

### 5. Worker deployen

```sh
cd workers/job-alerts
npm ci
npx wrangler secret put APP_URL     # <app-url>
npx wrangler secret put APP_TOKEN
# optional, nur wenn Schritt 2 einen Access-Service-Token nötig gemacht hat:
npx wrangler secret put CF_ACCESS_CLIENT_ID
npx wrangler secret put CF_ACCESS_CLIENT_SECRET
npm run deploy
```

Die Secrets und die App-Adresse stehen bewusst nicht in `wrangler.jsonc`, da das Repo öffentlich ist. Fehlt `APP_URL`, weist der Worker jede Mail vorübergehend ab (Log: `status=APP_URL not set`).

### 6. Catch-all prüfen und Regel anlegen

Zuerst prüfen, ob die Subdomain eine **eigene** Catch-all-Regel hat oder ob sich Subdomain und Apex-Domain eine zonenweite Catch-all-Regel teilen:

```sh
npx wrangler email routing rules list <zone>
npx wrangler email routing rules list <alerts-domain>
npx wrangler email routing rules get <zone> catch-all
npx wrangler email routing rules get <alerts-domain> catch-all
```

**Fall A: getrennte Catch-all-Regeln** (die Ausgaben unterscheiden sich, die der Subdomain ist eine eigene Regel). Nur dann die Catch-all-Regel von `<alerts-domain>` ändern. Die CLI hat keinen eigenen `catch-all`-Befehl; sie wird über `rules update` mit der Regel-ID `catch-all` geändert. `--match-type`, `--match-field` und `--match-value` entfallen dabei (sie werden für Catch-all ignoriert).

```sh
npx wrangler email routing rules update <alerts-domain> catch-all   --name "Job-Alerts an Vita" --enabled true   --action-type worker --action-value vita-job-alerts
npx wrangler email routing rules get <alerts-domain> catch-all
```

**Fall B: Cloudflare meldet eine gemeinsame Catch-all-Regel für die Zone**. Sie dann **nicht** ändern. Ein Umstellen der zonenweiten Catch-all-Regel auf den Worker würde die gesamte Mail der Hauptdomain an den Worker umleiten. Stattdessen pro Nutzeradresse eine Literal-Regel anlegen (bei höchstens 10 Nutzern machbar):

```sh
npx wrangler email routing rules create <alerts-domain>   --match-type literal --match-field to --match-value <adresse>   --action-type worker --action-value vita-job-alerts
```

Das ist für jede neu erzeugte (oder ersetzte) Adresse zu wiederholen.

### 7. Einrichtung pro Nutzer (in der App und in Gmail)

> **Warnung:** Die Prüfung des Envelope-Absenders (jetzt in der App) ist keine Authentifizierung. Der SPF-Eintrag von gmail.com ist nur `softfail`, der Absender lässt sich also fälschen. Bevor die Filter produktiv genutzt werden, muss eine SPF-/`Authentication-Results`-Prüfung ergänzt werden, und zwar anhand der Header einer echten weitergeleiteten Mail (einmalig mit `wrangler tail` protokollieren). Das betrifft jetzt alle Nutzer.

1. Auf der Account-Seite der App die eigene Job-Alert-Adresse erzeugen und die eigene Gmail-Adresse eintragen.
2. In Gmail unter **Einstellungen → Weiterleitung und POP/IMAP** die erzeugte Adresse als Weiterleitungsadresse hinzufügen.
3. Google schickt eine Bestätigungsmail an diese Adresse. Der Worker stellt sie der App zu. Den Bestätigungscode auf der Account-Seite ablesen und in Gmail eingeben.
4. In Gmail einen Filter anlegen:
   `from:(jobalerts-noreply@linkedin.com OR …)`
   Die Absender stammen aus den Fixtures. Aktion: **Weiterleiten an** die erzeugte Adresse.

### 8. Ende-zu-Ende prüfen

```sh
npm run tail
```

Eine Alert-Mail weiterleiten (oder den nächsten Alert abwarten). Im Log erscheint `job-alerts: delivered leads …`. Die Leads prüfen:

```sh
node scripts/api.ts GET "job-leads?status=new"
```

(Vom Repo-Root aus.) Eine Mail von einer fremden Adresse an die erzeugte Adresse muss abgelehnt werden. Im Log erscheint dann `rejected`.

## Hinweis

Die Test-Fixtures sind synthetisch. Sobald die ersten echten Alerts angekommen sind, die Parser (`src/parsers.ts`) mit anonymisierten echten Mails prüfen und die Fixtures ergänzen.
