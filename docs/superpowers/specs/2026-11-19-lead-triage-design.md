# Leads schneller abarbeiten: belastbare Scores, Triage-Ansicht, Text aus der Alert-Mail

## Warum

Das tägliche Stellenradar bewertet Leads automatisch, aber viele Anzeigen (Indeed,
Glassdoor, Instaffo) sind für den Agenten nicht lesbar. Deren Score ist nur aus Titel,
Firma und Ort geschätzt, sah in der App aber genauso aus wie ein gelesener. Die
Lead-Seite stapelt außerdem nur Karten. Ziel: Morgens die Leads öffnen, auf einen Blick
sehen, welche sich lohnen und wie belastbar das ist, und jeden Lead mit einem Klick
erledigen.

## Ziele

- Ein Score zeigt, ob er auf der gelesenen Anzeige beruht oder geschätzt ist.
- Ein Ausschlusskriterium lässt sich auch bei einer geschätzten Bewertung speichern.
- Die Lead-Seite sortiert vor (lohnt sich / prüfen / eher nicht) und lässt Leads schnell
  erledigen, auch versehentlich erledigte wiederherstellen.
- Leads aus Alert-Mails bringen den Text mit, den die Mail schon enthält, damit eine
  Schätzung auf mehr als dem Titel beruht.

## Nicht-Ziele

- Kein Editor für Gewichte und Schwelle (Schritt 2 aus dem Fit-Criteria-Design, eigenes Vorhaben).
- Keine Bewerbung automatisch anlegen; das bleibt `/bewerbung`.
- Kein Umgehen von Login-Wänden oder Bot-Sperren der Jobseiten.

## Anti-Ziele

- Eine geschätzte Bewertung darf nie wie eine gelesene aussehen oder einen Push auslösen.
- Erledigen darf nichts unwiderruflich verschwinden lassen.

## Drei Features, drei PRs (Reihenfolge)

### 1. `basis` einer Bewertung (`feat/lead-rating-basis`)

- `JobLead.basis?: 'read' | 'estimated'`, gespeichert im vorhandenen JSON-Feld `rating`
  (`{ basis, criteria?, exclusion? }`), keine neue Spalte.
- PATCH nimmt `basis` nur mit `score`. Ein `criteria` ohne `basis` heißt `read`.
  `estimated` verbietet `criteria`, erlaubt aber `exclusion`. `read` ohne Breakdown ist erlaubt.
- Ein neuer Score ohne `basis` und ohne Breakdown löscht `rating` wie bisher.
- Toleranter Leser für alte Zeilen: Breakdown vorhanden → `read`; kein Breakdown, aber
  `verdict` beginnt mit „Anzeige nicht lesbar“ → `estimated`; sonst kein `basis`.
- UI: geschätzter Score als „~60 %“ mit gestricheltem Rahmen und Tooltip, Ausschluss auch ohne Breakdown sichtbar.
- `/stellenradar`: sendet `basis`, liest Anzeigen mit WebFetch, pusht nur gelesene Treffer,
  berichtet als Tabelle mit gelesen/geschätzt.

### 2. Triage-Ansicht der Lead-Seite (`feat/lead-triage`, baut auf 1 auf)

Entschieden (Annahmen von Claude, der Nutzer hat die Rückfrage übersprungen):

- Standard-Tab „To decide“ (Status `rated`), gruppiert in **Worth a look** (gelesen, ≥ 70),
  **Check** (geschätzt ≥ 50 oder gelesen 50–69), **Unlikely** (< 50 oder Ausschluss,
  eingeklappt). 70 ist die Push-Schwelle aus den Prioritäten; solange die App sie nicht
  liest, steht sie als Konstante neben den anderen Score-Grenzen.
- Kopfzeile mit Zählern: zu entscheiden, unbewertet (`new`), davon geschätzt.
- Kompakte Zeilen statt großer Karten: Score, Titel, Firma · Ort, Quelle, Kurzurteil
  einzeilig; Breakdown aufklappbar.
- Aktionen je Lead: Anzeige öffnen, „Dismiss“, „Mark as applied“; nach dem Erledigen
  eine Rückgängig-Leiste für einige Sekunden.
- „Dismiss all“ für die Gruppe Unlikely, ebenfalls mit Rückgängig.

### 3. Text aus der Alert-Mail am Lead (`feat/lead-snippet`)

- `JobLeadInput.snippet?: string` (bis 1000 Zeichen): der Text, den die Alert-Mail zum
  Job zeigt (Ausschnitt, Gehalt, Arbeitsmodell), vom Mail-Worker aus dem Umfeld des Links
  gelesen.
- Neue Spalte `snippet` (additiv, Migration in `migrate()`), bekannte Leads bekommen ihn
  beim erneuten Melden nachgetragen.
- `/stellenradar` nutzt ihn, wenn die Anzeige nicht lesbar ist; die Bewertung bleibt
  `estimated`, das Urteil nennt den Ausschnitt als Grundlage.
- UI zeigt den Ausschnitt aufklappbar am Lead.

## Was dem Umsetzenden bleibt

Konkrete Texte, Abstände und Farben im bestehenden Tailwind-Token-Stil; wie der Worker
den Ausschnitt je Plattform findet (pro Parser, mit Fixtures).
