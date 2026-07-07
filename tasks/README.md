# Task-Prompts – Leitfaden für den Einsatz günstiger AI-Modelle

Dieses Verzeichnis enthält die Arbeitspakete (Epics E00–E10), zerlegt in Tasks,
die **einzeln** an ein günstiges Umsetzungs-Modell (z. B. Haiku-/Mini-Klasse)
gegeben werden. Die Prompts sind bewusst so geschrieben, dass sie ohne weiteres
Projektwissen funktionieren — trotzdem gilt:

## 1. So wird ein Task beauftragt (Prompt-Zusammenbau)

Der finale Prompt an das Umsetzungs-Modell besteht aus **vier Blöcken**:

```
[BLOCK 1 – Systemkontext]  → unten stehender "Globaler Systemprompt", wörtlich
[BLOCK 2 – Referenzdokumente] → Inhalt der im Task unter "Kontext-Dokumente"
                                genannten docs/-Abschnitte einfügen
[BLOCK 3 – Task]           → der komplette Task-Abschnitt aus der Epic-Datei
[BLOCK 4 – Aktueller Code] → relevante bestehende Dateien (Task nennt sie unter
                             "Berührte Pfade"); bei E00 entfällt das
```

> Faustregel Kontextbudget: Blöcke 2+4 zusammen < 20k Tokens halten. Lieber die
> genannten Abschnitte als ganze Dateien einfügen.

## 2. Globaler Systemprompt (BLOCK 1, wörtlich verwenden)

```
Du bist ein sorgfältiger Senior-TypeScript-Entwickler und setzt EXAKT EINEN
klar definierten Task im Projekt "Yapaja Go" um (browserbasierte Offline-
Navigations-App für Wohnmobile; Monorepo: pnpm workspaces, TypeScript strict,
Frontend React 18 + Vite + MapLibre GL + Zustand + Tailwind, Backend Node 20 +
Fastify + better-sqlite3, Tests mit Vitest/Playwright).

VERBINDLICHE REGELN:
1. Setze NUR den beschriebenen Task um. Keine zusätzlichen Features, keine
   Refactorings außerhalb der genannten Pfade, keine neuen Dependencies außer
   den im Task erlaubten.
2. Halte dich exakt an die vorgegebenen Schnittstellen (Pfade, Typen, Schemata,
   Endpunkte, Topics). Wenn der Task einen Typ oder ein Schema definiert,
   übernimm es zeichengenau.
3. TypeScript strict, keine `any` außer mit Begründungskommentar. ESM-Module.
4. Schreibe zu jeder neuen Logik Unit-Tests (Vitest) im selben PR. Die im Task
   genannten Testfälle sind PFLICHT und namentlich umzusetzen.
5. Führe vor Abgabe aus: pnpm lint && pnpm typecheck && pnpm test. Gib die
   (zusammengefassten) Ergebnisse in deiner Antwort an. Behaupte niemals,
   Tests seien grün, wenn du sie nicht ausgeführt hast — wenn du sie nicht
   ausführen kannst, schreibe das explizit.
6. Fehlerbehandlung: keine stillen Fehlschläge. Externe Aufrufe (Valhalla,
   Photon, gpsd, MQTT) immer mit Timeout, klarer Fehlermeldung im Format
   {error:{code,message}} und Log-Eintrag.
7. Wenn eine Vorgabe unklar oder widersprüchlich ist: NICHT raten. Liste die
   offene Frage am Anfang deiner Antwort unter "KLÄRUNGSBEDARF" und setze nur
   die eindeutigen Teile um.
8. Ausgabeformat: (a) Kurzzusammenfassung, (b) KLÄRUNGSBEDARF (falls vorhanden),
   (c) vollständige neue/geänderte Dateien mit Pfadangabe, (d) Testergebnisse,
   (e) Nachweis je Akzeptanzkriterium (Kriterium → wie erfüllt/wo getestet).
```

## 3. Task-Format (so lesen sich die Epic-Dateien)

Jeder Task hat: **ID · Titel · Abhängigkeiten · Kontext-Dokumente · Berührte
Pfade · Erlaubte neue Dependencies · Aufgabe (der eigentliche Prompt) ·
Akzeptanzkriterien · Pflicht-Tests · Plausibilitäts-Checks**.

- *Akzeptanzkriterien* = was der Reviewer prüft (beobachtbares Verhalten).
- *Pflicht-Tests* = Tests, die das Modell selbst schreiben und ausführen muss.
- *Plausibilitäts-Checks* = fachliche Sanity-Prüfungen (docs/07 §3), die über
  „Test grün" hinausgehen.

## 4. Abnahme-Checkliste (für Review-Modell oder Mensch, je PR)

- [ ] Diff berührt nur die im Task genannten Pfade (+ Tests, + generierte Doku).
- [ ] Alle Akzeptanzkriterien einzeln nachgewiesen (nicht pauschal „done").
- [ ] Pflicht-Tests vorhanden, sinnvoll (prüfen Verhalten, nicht Implementierung),
      und in CI grün.
- [ ] Keine neuen Dependencies außer erlaubten; `pnpm audit` ohne neue High/Critical.
- [ ] Schemata in `packages/shared` geändert? → Contract-Tests + OpenAPI regeneriert,
      Version angehoben.
- [ ] Fehlerpfade implementiert (Timeout, Service down, ungültige Eingabe) — im
      Zweifel einen Fehlerfall manuell provozieren.
- [ ] Plausibilitäts-Checks des Tasks stichprobenartig nachvollzogen.
- [ ] Keine Konsolen-Errors im Browser (bei Frontend-Tasks Playwright-Log prüfen).
- [ ] Bei sicherheitsrelevanten Tasks (🔴-Wargame-Bezug): Negativ-Tests vorhanden
      (das Verbotene passiert nachweislich NICHT).

**Eskalationsregel:** Meldet das Umsetzungs-Modell KLÄRUNGSBEDARF oder scheitert
zweimal am selben Task, geht der Task zurück an den Architekten (Task-Beschreibung
präzisieren), NICHT in eine dritte blinde Runde.

## 5. Reihenfolge & Parallelisierung

Verbindliche Reihenfolge und was parallel laufen darf: `docs/02-roadmap-milestones.md`.
Innerhalb eines Epics sind die Tasks in Abhängigkeitsreihenfolge nummeriert —
T1 vor T2, außer der Task nennt explizit andere Abhängigkeiten.
