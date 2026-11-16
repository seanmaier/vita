# Job-Alerts-Worker (vita-job-alerts)

Ein Cloudflare Email Worker, der weitergeleitete Job-Alert-Mails (Gmail, Outlook, iCloud) übernimmt und pro Nutzer an die Vita-App zustellt.

## Was der Worker macht

Jeder Nutzer bekommt auf der Account-Seite der App eine eigene Adresse (z. B. `jobs-k7x2@alerts.example.org`). Eine Regel im Postfach des Nutzers (Gmail-Filter, Outlook-Regel „Umleiten an“, iCloud-Regel) leitet Job-Alert-Mails (z. B. von LinkedIn) an diese Adresse weiter. Für jede Nutzeradresse gibt es in Cloudflare Email Routing eine eigene Regel, die die Mail an den Worker übergibt. Catch-all-Regeln gibt es bei Cloudflare nur für die Hauptdomain, nicht für Subdomains.

Der Worker kennt keine Nutzeradressen. Er prüft, ob Cloudflare den Envelope-Absender per SPF bestätigt hat: Nur der oberste `Authentication-Results`-Header zählt, er muss von `mx.cloudflare.net` stammen und `spf=pass` mit `smtp.mailfrom=<Envelope-Absender>` enthalten (tiefere Header stammen von früheren Stationen und lassen sich fälschen). Fehlt das, meldet er nur `kind: failed` mit `sender not verified (SPF)`, ohne Inhalt. Sonst parst er die Mail und sendet sie per `POST /api/v1/inbound-mail` an die App. Der Body enthält `recipient` (Empfängeradresse), `envelopeFrom`, `kind` (`leads`, `confirmation` oder `failed`) sowie je nach Fall `subject`, `sender`, `detail` und `leads`. Die App ordnet die Empfängeradresse einem Nutzer zu und prüft, ob der Envelope-Absender ohne den Teil ab `+` zu dessen eingetragener Weiterleitungsadresse passt (Gmail: `name+caf_=…@gmail.com`, Outlook: `name+SRS=…@outlook.com`, iCloud: `name@icloud.com`).

- 201: zugestellt.
- 400, 403, 404: Die App lehnt die Mail ab. Der Worker weist sie mit `not accepted` ab, ohne Wiederholung.
- Netzwerkfehler, 5xx, Weiterleitungen oder sonstige Antworten: Der Worker wiederholt einmal nach 2 s. Hilft das nicht, weist er die Mail mit `Vita is unavailable right now; please forward this mail again later` ab. Cloudflares `setReject` ist eine permanente Ablehnung: Das Postfach wiederholt nicht, der Absender erhält einen Bounce und muss die Mail später erneut weiterleiten. Nichts wird still verworfen.

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

### Lokal testen (ohne Cloudflare)

`wrangler dev` simuliert Email Routing: Eine Mail per `POST` an `/cdn-cgi/handler/email` landet im `email()`-Handler, so als hätte Cloudflare sie zugestellt. Die App läuft dabei lokal (`npm run dev:all` im Repo-Root).

1. In der `.env` der App `INBOUND_DOMAIN=alerts.example.org` setzen und die App neu starten.
2. Token erzeugen (im Repo-Root): `node server/cli.ts token-add <user> local-mail-worker --scope inbound:deliver`
3. `cp .dev.vars.example .dev.vars` und den Token als `APP_TOKEN` eintragen.
4. In der App auf der Account-Seite eine Adresse erzeugen und eine Weiterleitungsadresse eintragen.
5. Worker starten: `npx wrangler dev`
6. Eine Mail schicken. `from` ist der Envelope-Absender und muss zur eingetragenen Weiterleitungsadresse passen, `to` ist die erzeugte Adresse. Die Datei ist eine komplette MIME-Mail (Header, Leerzeile, HTML-Body aus `test/fixtures`). Lokal setzt niemand den SPF-Header, deshalb muss er als erste Zeile in der Datei stehen: `Authentication-Results: mx.cloudflare.net; spf=pass smtp.mailfrom=<from>`

   ```sh
   curl -X POST "http://localhost:8787/cdn-cgi/handler/email?from=<weiterleitungsadresse>&to=<adresse>" --data-binary @mail.eml
   ```

   Ergebnis: `Worker successfully processed email`, im Log `job-alerts: delivered leads …`, und die Leads erscheinen in der App. Mit einem anderen `from` lehnt der Worker die Mail ab (`not accepted`, Status 403).

## Einrichtung

**Reihenfolge:** Zuerst die App deployen, dann in der App den `inbound:deliver`-Token erzeugen (Schritt 4), erst danach den Worker deployen (Schritt 5). Der Worker stellt sonst an eine App zu, die den Endpoint noch nicht kennt. Die Empfangsdomain stellt die App über die Umgebungsvariable `INBOUND_DOMAIN` ein; ohne sie ist die Funktion in der App aus. Sie muss die Subdomain sein, für die Email Routing eingerichtet ist.

In den Befehlen unten steht `<zone>` für die Cloudflare-Zone (z. B. `example.org`), `<alerts-domain>` für die Empfangsdomain, also den Wert von `INBOUND_DOMAIN` (z. B. `alerts.example.org`), und `<app-url>` für die Adresse der App (z. B. `https://vita.example.org`). Alle `wrangler email routing`-Befehle bekommen die **Zone**, nie die Subdomain; mit einer Subdomain melden sie `Could not find zone`.

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

Subdomains lassen sich nur im Dashboard hinzufügen; die CLI kennt nur Zonen.

1. Vorher prüfen, ob die Hauptdomain Mails bei einem anderen Anbieter empfängt: `nslookup -type=mx <zone>`. Dann darf Email Routing die MX-Einträge der Hauptdomain **nicht** ersetzen; schlägt Cloudflare das vor, abbrechen.
2. **Compute → Email Service → Email Routing**, die Zone wählen, **Settings → Subdomains**: `<alerts-domain>` eintragen und absenden. Cloudflare legt MX- und SPF-Einträge für die Subdomain an.
3. Prüfen (dauert meist wenige Minuten):

   ```sh
   nslookup -type=mx <alerts-domain>     # erwartet: route1/2/3.mx.cloudflare.net
   ```

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

### 6. Regel pro Nutzeradresse anlegen

Catch-all-Regeln gibt es nur für die Hauptdomain. Jede Adresse, die ein Nutzer auf der Account-Seite erzeugt, braucht deshalb eine eigene Regel. Bis sie existiert, lehnt Cloudflare Mails an die Adresse ab (`mx.cloudflare.net rejected your message`). Bei höchstens 10 Nutzern ist das ein Befehl pro Nutzer:

```sh
npx wrangler email routing rules create <zone>   --name "Vita: <user>"   --match-type literal --match-field to --match-value <adresse>   --action-type worker --action-value vita-job-alerts
```

Im Dashboard: **Email Routing → Routing rules → Create address**, den Teil vor dem `@` eintragen, Domain `<alerts-domain>` wählen, Aktion **Send to a Worker** → `vita-job-alerts`.

Ersetzt ein Nutzer seine Adresse, die neue Regel anlegen und die alte löschen:

```sh
npx wrangler email routing rules list <zone>                # Regel-ID heraussuchen
npx wrangler email routing rules delete <zone> <rule-id>
```

### 7. Einrichtung pro Nutzer (in der App und im Postfach)

1. Auf der Account-Seite der App die eigene Job-Alert-Adresse erzeugen und die Adresse eintragen, von der weitergeleitet wird. Die Alert-Adresse dem Admin schicken, der die Regel aus Schritt 6 anlegt.
2. Im Postfach eine Regel für die Job-Alert-Absender anlegen, z. B. `jobalerts-noreply@linkedin.com` (die Absender stammen aus den Fixtures):
   - **Gmail:** unter **Einstellungen → Weiterleitung und POP/IMAP** die Alert-Adresse hinzufügen. Google schickt eine Bestätigungsmail, der Worker stellt sie der App zu; den Code auf der Account-Seite ablesen und in Gmail eingeben. Dann einen Filter `from:(jobalerts-noreply@linkedin.com OR …)` mit **Weiterleiten an** die Alert-Adresse.
   - **Outlook.com:** **Einstellungen → E-Mail → Regeln**, Bedingung „Von“, Aktion **„Umleiten an“** (nicht „Weiterleiten an“).
   - **iCloud:** icloud.com → **Mail → Einstellungen → Regeln**, „Von“, **„Weiterleiten an“**.

Angenommen wird eine Mail nur, wenn Cloudflare den Envelope-Absender per SPF bestätigt und dieser ohne den Teil ab `+` der eingetragenen Adresse entspricht. Getestet sind Gmail, Outlook.com und iCloud; Microsoft-365-Firmenkonten schreiben den Absender anders um (`bounces+SRS=…@firma`) und passen nicht. Eine **von Hand** weitergeleitete Mail taugt nicht als Test für Leads: Sie kommt von dir statt von der Jobbörse, die Alert-Quelle ist unbekannt, und die App verbucht sie als `failed`.

### 8. Ende-zu-Ende prüfen

```sh
npm run tail
```

Eine Alert-Mail weiterleiten (oder den nächsten Alert abwarten). Im Log erscheint `job-alerts: delivered leads …`. Die Leads prüfen:

```sh
node scripts/api.ts GET "job-leads?status=new"
```

(Vom Repo-Root aus.) Eine Mail von einer fremden Adresse an die erzeugte Adresse muss abgelehnt werden. Im Log erscheint dann `rejected`.

Bounces einordnen:

- **`mx.cloudflare.net rejected your message`, kein Eintrag im Log:** Für die Adresse fehlt die Regel aus Schritt 6 (oder DNS ist noch nicht durch).
- **Log `rejected … status=403`:** Der Envelope-Absender (ohne den Teil ab `+`) passt nicht zur eingetragenen Weiterleitungsadresse.
- **Log `failed (spf)`:** Cloudflare hat den Absender nicht per SPF bestätigt. Die App speichert nur ein `failed`-Ereignis, wenn die Adresse passt, sonst 403.
- **Log `rejected … status=404`:** Die App kennt die Adresse nicht, oder `INBOUND_DOMAIN` passt nicht zur Subdomain.
- **Log `unavailable …`:** Die App ist nicht erreichbar, oder `APP_URL`/`APP_TOKEN` fehlen.

## Diagnose: Header protokollieren

Um zu sehen, was Cloudflare bei weitergeleiteten oder umgeleiteten Mails mitliefert (z. B. aus Outlook oder iCloud), lässt sich ein Header-Log einschalten:

```sh
npx wrangler secret put LOG_HEADERS --name vita-job-alerts    # Wert: 1
npx wrangler tail vita-job-alerts
```

Pro Mail erscheint eine Zeile `job-alerts: headers {...}` mit Envelope-Absender und -Empfänger, der `From`-Adresse, `Authentication-Results`, `ARC-Authentication-Results`, `Received-SPF` und je DKIM-Signatur nur Domain (`d`) und Selector (`s`). Betreff, Inhalt und Signaturdaten werden nie protokolliert. Danach wieder ausschalten:

```sh
npx wrangler secret delete LOG_HEADERS --name vita-job-alerts
```

## Hinweis

Die Test-Fixtures sind synthetisch. Sobald die ersten echten Alerts angekommen sind, die Parser (`src/parsers.ts`) mit anonymisierten echten Mails prüfen und die Fixtures ergänzen.
