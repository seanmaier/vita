---
name: basiswissen
description: Baut das persönliche Basiswissen für KI-gestützte Bewerbungen auf oder ergänzt es (Basiswissen in der App) - liest die vorhandenen Basis-Profile über /api/v1 und interviewt den Nutzer gezielt zu Projekten, Erfahrung, Skill-Niveaus und Schreibstil. Verwenden bei "/basiswissen", wenn der Nutzer sein Basiswissen pflegen will, oder wenn /bewerbung meldet, dass es fehlt oder lückenhaft ist.
argument-hint: "[optional: Abschnitt oder Projekt, das ergänzt werden soll]"
---

# Basiswissen aufbauen

Ziel ist das Dokument `about-me` (Basiswissen in der App; Arbeitskopie `private/knowledge/about-me.md`,
gitignored). Es ist die Grundlage für
`/bewerbung`: Je konkreter die Belege, desto besser die Anschreiben. `$ARGUMENTS` kann
einen Abschnitt oder ein Projekt nennen, auf das du dich beschränkst.

## Ablauf

1. **Dokument holen.** `node scripts/knowledge.ts pull` speichert die Dokumente aus der App
   nach `private/knowledge/` (Arbeitskopie). Bearbeitet wird diese Datei; nach jeder Änderung
   `node scripts/knowledge.ts push about-me`. Fehlt das Dokument in der App (`pull` meldet
   „not saved“, `get` endet mit Exit 2) und existiert die Arbeitskopie
   `private/knowledge/about-me.md`, diese mit `node scripts/knowledge.ts push about-me`
   hochladen. Die Vorlage `private/knowledge/about-me.example.md` nur verwenden, wenn es
   auch lokal keine Datei gibt (nach `about-me.md` kopieren, Hinweisblock am Anfang
   entfernen, dann `push`). Endet `pull` mit Exit 3, unterscheidet sich eine lokale Datei
   von der App-Version (die liegt dann als `private/knowledge/<doc>.server.md` daneben):
   Unterschiede kurz zeigen und den Nutzer fragen, welche Version gelten soll (lokale Datei
   mit `push` hochladen oder durch die `.server.md`-Kopie ersetzen). Nie stillschweigend
   weitermachen.
2. **Vorhandene Daten einlesen.** `node scripts/api.ts GET base-profiles` (siehe Skill
   `bewerbung` zur Einrichtung) und, falls vorhanden, `private/profiles/*.json`. Daraus
   vorbefüllen, was sich ableiten lässt: Stationen, Projekte mit ihrer `id`, Skills,
   Ausbildung. Für jedes Projekt im Basis-Profil einen Abschnitt mit der passenden `id`
   anlegen.
3. **Lücken bestimmen.** Pro Abschnitt prüfen, was fehlt. Priorität:
   1. Projekte: Problem, eigene Rolle, Entscheidungen, Ergebnis mit Zahlen
   2. Berufserfahrung: konkrete Ergebnisse
   3. Skill-Niveaus (verhindert Übertreibung in Bewerbungen)
   4. Schreibstil und Tabus
   5. Suchkriterien und Ausschlusskriterien
4. **Interview.** Pro Runde höchstens 3–4 konkrete Fragen zu **einem** Thema stellen,
   z. B. „Bei <Projekt>: Was war die schwierigste technische Entscheidung, und wie viele
   Nutzer hat es?" Keine allgemeinen Fragen wie „Erzähl mir von dir". Antworten nach jeder
   Runde sofort in die Arbeitskopie schreiben und mit `push` hochladen, in den Worten des
   Nutzers, nur sprachlich geglättet.
5. **Abschließen**, wenn der Nutzer aufhören will oder die Prioritäten 1–4 gefüllt sind.
   Kurz zusammenfassen, was ergänzt wurde und was noch offen ist.

## Regeln

- Nichts erfinden oder ausschmücken. Unbekanntes als `offen` markieren.
- Ergeben sich Verbesserungen für ein Basis-Profil (z. B. ein Projekt fehlt dort oder eine
  Beschreibung ist schwach), als Vorschlag zeigen und nur nach Bestätigung per
  `node scripts/api.ts PUT base-profiles/<id> <datei.json>` speichern. Der Body enthält
  `name`, `language` und das **vollständige** `profile`.
- Das Dokument enthält persönliche Daten: Inhalte nie committen und nur an die eigene App (`JOB_APPS_URL`) senden, an keine anderen Dienste.
