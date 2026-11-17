---
name: stellencheck
description: Bewertet eine Stellenanzeige gegen die Prioritäten und Skills des Nutzers und sagt, ob sie zu ihm passt und zu wie viel Prozent - mit Ausschlusskriterien, gewichteten Kriterien und Empfehlung. Fragt beim ersten Mal (oder mit "prioritaeten") die Prioritäten ab und speichert sie als Basiswissen in der App. Verwenden bei "/stellencheck", wenn der Nutzer eine Stelle (URL oder Text) zur Einschätzung schickt, fragt "passt die Stelle zu mir?", oder bevor /bewerbung eine Bewerbung anlegt.
argument-hint: "<URL oder Text der Stellenanzeige> | prioritaeten"
---

# Stellencheck

Ziel: schnell und ehrlich entscheiden, ob sich eine Bewerbung lohnt. Grundlage sind
dem Dokument `priorities` (was der Nutzer will) und `about-me` (was er kann), beide als
Basiswissen in der App gespeichert.

**Zu Beginn** `node scripts/knowledge.ts pull`: Das legt die Arbeitskopien
`private/knowledge/priorities.md` und `about-me.md` an (gitignored). Bearbeitet wird die
Arbeitskopie; nach jeder Änderung `node scripts/knowledge.ts push priorities` (bzw.
`about-me`). Fehlt ein Dokument in der App (`pull` meldet „not saved“, `get` endet mit
Exit 2) und existiert die Arbeitskopie `private/knowledge/<doc>.md`, diese mit
`node scripts/knowledge.ts push <doc>` hochladen. Die Vorlage unten (`priorities`) bzw.
`private/knowledge/about-me.example.md` (`about-me`) nur verwenden, wenn es auch lokal keine
Datei gibt; dann anlegen und mit `push` hochladen. Endet `pull` mit Exit 3, unterscheidet
sich eine lokale Datei von der App-Version (diese liegt als `<doc>.server.md` daneben):
Unterschiede kurz zeigen und den Nutzer fragen, welche gelten soll (lokale Datei mit `push`
hochladen oder durch die `.server.md`-Kopie ersetzen). Nie stillschweigend weitermachen.

Datenschutz: Inhalte nie committen und nur an die eigene App (`JOB_APPS_URL`) senden, an keine anderen Dienste.

`$ARGUMENTS` ist die Stellenanzeige. Bei `prioritaeten` oder wenn `priorities.md` fehlt:
zuerst **Prioritäten erfassen**.

## Prioritäten erfassen (einmalig, später nur bei Bedarf)

1. `priorities.md` lesen, falls vorhanden; sonst aus dem Abschnitt „Kurzprofil“ von
   `about-me.md` vorbefüllen.
2. Nur fragen, was fehlt, höchstens 4 Fragen pro Runde. Zu klären:
   - **Ausschlusskriterien** (sofort „passt nicht“): z. B. Freelance, Vor-Ort-Pflicht in
     anderer Stadt, Seniorität, Branchen, die er nicht will
   - **Arbeitsmodell und Ort**: hybrid / remote / vor Ort, Stadt, maximaler Pendelweg,
     Office-Tage pro Woche
   - **Rolle**: Backend, Full-Stack mit Backend-Fokus, …; Seniorität
   - **Stack**: Haupt- und Zweitsprache, was er lernen will, was er nicht will
   - **Themen und Domänen**, die ihn reizen oder abschrecken
   - **Gehalt**: Untergrenze und Wunsch (nur zur Bewertung, nie in Anschreiben)
   - **Sprache, Unternehmensgröße, Lernumfeld/Mentoring**
   - **Gewichte**: die Standardgewichte unten zeigen und fragen, ob sie passen
3. Antworten sofort in `priorities.md` schreiben (Vorlage siehe unten) und mit
   `node scripts/knowledge.ts push priorities` hochladen.

## Stelle bewerten

1. **Anzeige lesen** (URL per Web-Fetch-Werkzeug, Text direkt). Extrahieren: Firma, Rolle,
   Anstellungsart, Arbeitsmodell und Ort, Seniorität und geforderte Jahre, Muss- und
   Kann-Anforderungen, Stack, Domäne, Gehalt, Sprache.
   **Schon bekannt?** `node scripts/api.ts GET applications` lesen (enthält auch geprüfte
   Stellen mit Status `evaluated` und `skipped`). Gibt es eine mit derselben `url` oder
   derselben Firma und ähnlicher Rolle, das sofort sagen, mit Status und bisheriger
   Passung (z. B. „CHECK24 hattest du schon, Status rejected“). Ab `drafting` nicht neu
   bewerten, außer der Nutzer will es.
2. **Ausschlusskriterien prüfen.** Trifft eines zu: Gesamtwert höchstens 20 %, Empfehlung
   „nicht bewerben“, Grund an erster Stelle nennen. Ist es nur unklar (z. B. Anstellungsart
   nicht genannt), nicht ausschließen, sondern als offene Frage markieren.
3. **Kriterien bewerten.** Jedes Kriterium bekommt einen Erfüllungsgrad von 0–100 %, der mit
   seinem Gewicht aus `priorities.md` multipliziert wird. Summe = Passung in %.
   - Ist etwas in der Anzeige nicht angegeben: 50 % ansetzen und als „unbekannt“ markieren,
     nicht raten.
   - **Skill-Passung** nur gegen `about-me.md` messen: „Hauptsprache“/„produktiv“ zählt voll,
     „lernend“ halb, nicht belegt gar nicht. Muss-Anforderungen wiegen doppelt so viel wie
     Kann-Anforderungen.
   - **Erfüllbarkeit**: Geforderte Berufsjahre und Seniorität mit der tatsächlichen
     Erfahrung vergleichen (Berufsjahre in `about-me.md`). „3+ Jahre“ bei ca. 3 Jahren ist
     erfüllbar; „Senior, 5+ Jahre“ nicht.
4. **Ergebnis zeigen** (Format unten). Ehrlich bleiben: lieber eine Stelle abraten als eine
   Bewerbung ins Leere schicken.
5. **In der App speichern** (ohne eigene Rückfrage; das Ergebnis ist gerade gezeigt worden).
   Das Feld `fit` ist
   `{ "score": <0–100>, "cappedScore": <nur bei Deckel>, "recommendation": "apply" | "apply-if" | "unlikely" | "exclude", "reason": "<der Satz aus dem Ergebnis, bei apply-if mit Bedingung>", "evaluatedAt": "<ISO-Zeit>" }`
   (`apply` = bewerben, `apply-if` = bewerben, wenn …, `unlikely` = eher nicht,
   `exclude` = Ausschlusskriterium).
   - Neue Stelle: `POST applications` mit `company`, `role`, `url`, `language` (Sprache der
     Anzeige), `"status": "evaluated"`, `fit`, `notes` (Kriterientabelle, Stärken, Risiken,
     offene Fragen als eine Notiz) und `changeMessage` („Stellencheck: NN %“).
   - Schon vorhanden: `PATCH applications/<id>` mit dem neuen `fit` und `changeMessage`.
   Body wie bei `/bewerbung` als UTF-8-JSON ins Scratchpad schreiben. Dem Nutzer die ID nennen.
   Die alte Tabelle „Bewertete Stellen“ in `priorities.md` nicht mehr fortschreiben.
6. **Entscheidung festhalten**: Sagt der Nutzer, dass er sich nicht bewirbt,
   `POST applications/<id>/transitions` mit `{ "to": "skipped" }`. Will er sich bewerben,
   übernimmt `/bewerbung` (Übergang zu `drafting`).
7. **Kalibrieren**: Entscheidet der Nutzer anders als die Empfehlung (bewirbt sich bei
   < 50 % oder lehnt > 75 % ab), nach dem Grund fragen und anbieten, Gewichte oder
   Ausschlusskriterien anzupassen. Für einen Überblick `GET applications` lesen und
   `fit` mit dem Status vergleichen: Wie oft führten hohe Werte zu `interview` oder
   `offer`, wie oft zu `rejected` oder `ghosted`?
8. **Weiter**: Bei „bewerben“ anbieten, direkt mit `/bewerbung <URL>` weiterzumachen.

## Ausgabeformat

```
## <Firma> – <Rolle>: <Passung> %  →  <Empfehlung>

<Ein Satz: der wichtigste Grund für die Empfehlung.>

| Kriterium | Gewicht | Erfüllt | Punkte | Begründung |
|---|---|---|---|---|
| … | 20 | 75 % | 15 | … |
| **Summe** | 100 | | **NN** | |

**Stärken:** 2–3 Punkte, die für die Stelle sprechen
**Risiken / Lücken:** Muss-Anforderungen, die fehlen; Unklares
**Offene Fragen an die Firma:** z. B. Office-Tage, Gehalt, Teamgröße
```

Empfehlungsstufen: **≥ 75 %** „bewerben“, **50–74 %** „bewerben, wenn …“ (Bedingung
nennen), **< 50 %** „eher nicht“, Ausschlusskriterium „nicht bewerben“.

## Vorlage für `priorities.md`

```markdown
# Prioritäten für die Jobsuche

Stand: <Datum>

## Ausschlusskriterien
- …

## Kriterien und Gewichte (Summe 100)

| Kriterium | Gewicht | 100 % heißt | 0 % heißt |
|---|---|---|---|
| Anstellung & Arbeitsmodell | 15 | … | … |
| Rollenfokus | 20 | … | … |
| Stack-Passung | 20 | … | … |
| Erfüllbarkeit / Seniorität | 15 | … | … |
| Themen & Domäne | 10 | … | … |
| Standort & Pendeln | 10 | … | … |
| Lernumfeld & Team | 5 | … | … |
| Gehalt | 5 | … | … |

## Details
- Ort, Pendelweg, Office-Tage: …
- Gehalt (Untergrenze / Wunsch): …
- …

## Radar
- Suchen: "Backend Entwickler" in Hamburg, 30 km; "C# Entwickler" in Hamburg, 30 km
- Schwelle für Push: 70 %
- Höchstens bewertet pro Lauf: 25
```

Geprüfte Stellen stehen in der App (Status `evaluated`/`skipped`, Feld `fit`), nicht mehr in
`priorities.md`. Eine vorhandene Tabelle „Bewertete Stellen“ bleibt als Archiv stehen.
