# E06 – Fahrzeugprofile

**Ziel:** Verwaltung der Fahrzeugprofile (Höhe, Breite, Länge, Gewicht,
Ø-Reisegeschwindigkeit) als Grundlage für sicheres Routing. **Gate-Beitrag G2.**

---

## E06-T1: Profil-Backend (CRUD + Aktivierung)

- **Abhängigkeiten:** E00-T2 · **Kontext:** docs/03 §1 `VehicleProfile`, §2 Profile
- **Pfade:** `apps/core/src/profiles/`

**Aufgabe:** SQLite-Tabelle + Endpoints exakt nach docs/03 §2. Validierung über
das shared-Schema (Wertebereiche: height 1.0–4.5, width 1.5–3.0, length 3.0–20.0,
weight 1.0–40.0, avg_speed 40–130). Regeln: genau EIN aktives Profil (Aktivieren
deaktiviert andere, transaktional); aktives Profil nicht löschbar (409); beim
ersten Start wird Default-Profil „Camper" (3.0/2.2/6.5/3.5t/85) angelegt.
`PUT /profiles/{id}/activate` publiziert `event/profile_changed {id, name}` —
E04 hängt sich später dran (Reroute).

**Akzeptanz:** 1. CRUD-Zyklus vollständig; 2. Validierung weist jeden
Bereichsverstoß mit feldgenauer Fehlermeldung ab; 3. Aktivierungs-Invariante hält
auch bei parallelen Requests (Transaktionstest).
**Pflicht-Tests:** CRUD-Integration; Validierungs-Tabelle (jede Grenze ±ε);
Parallel-Aktivierung; Default-Anlage idempotent.
**Plausibilität:** Nach beliebiger Operationsfolge gilt: COUNT(is_active)=1.

---

## E06-T2: Profil-UI (Editor + Schnellumschalter)

- **Abhängigkeiten:** E06-T1 · **Kontext:** docs/06 §1 (Profil-Chip top-bar), §4; docs/00 Rechtliches
- **Pfade:** `apps/web/src/profiles/`

**Aufgabe:** Profil-Chip in der top-bar (Icon + Name des aktiven Profils) →
Sheet mit Profilliste (antippen = aktivieren) + „Neues Profil". Editor:
Formular mit Schiebereglern UND Zahlenfeldern je Maß (Einheiten cm-genau für
Maße, 0,1 t für Gewicht), visuelle Fahrzeug-Silhouette, die sich mit den Maßen
skaliert (einfache SVG — hilft Tippfehler erkennen: 6,5 m hoch sieht sofort
falsch aus), avoid-Toggles, Ø-Geschwindigkeit. **Sicherheits-UX:** beim
Speichern mit height > 2,7 m einmalig Hinweis-Dialog (W-08-Disclaimer-Text aus
docs/08). Warnung bei „verdächtigen" Werten (height < 1,8 m bei weight > 3 t →
„Sicher? Das wirkt wie ein PKW-Wert") — nur Hinweis, kein Block.

**Akzeptanz:** 1. Anlegen/Bearbeiten/Aktivieren/Löschen komplett per Touch;
2. Silhouette skaliert live; 3. Disclaimer erscheint genau in den definierten
Fällen; 4. Feldfehler erscheinen am Feld (nicht als Toast).
**Pflicht-Tests:** Playwright: kompletter Editor-Flow inkl. Validierungsfehler;
Unit: Verdächtig-Werte-Heuristik (Tabelle).
**Plausibilität:** Umschalten des Profils ändert sofort den Chip UND (ab E03)
die nächste Routenberechnung — Playwright prüft, dass Route nach Wechsel
neu berechnet wird bzw. Hinweis erscheint.

---

## E06-T3: Profilwechsel während Navigation (Reroute-Kopplung)

- **Abhängigkeiten:** E06-T1/T2, E04-T4 · **Kontext:** docs/03 §2 (activate-Verhalten)
- **Pfade:** `apps/core/src/navigation/`, `apps/web/src/profiles/`

**Aufgabe:** Bei `event/profile_changed` während `navigating|paused`:
Bestätigungs-Banner im UI („Mit ‚Alkoven 7,5 t' neu berechnen?" Ja/Abbrechen —
Abbrechen reaktiviert altes Profil). Bei Ja: Reroute mit neuem Profil
(`route/updated {reason:'profile_change'}`), Warnbanner falls neue Route deutlich
länger (> 15 % Dauer). Über MQTT/API ausgelöster Wechsel (später E08): gleiche
Logik, Bestätigung nur im UI wenn ein Client verbunden ist, sonst auto-ja + Event.

**Akzeptanz:** 1. E2E-Flow 5 grün (Wechsel → Bestätigung → neue Route + Banner);
2. Abbrechen stellt exakt den vorherigen Zustand her; 3. Headless-Wechsel
(kein UI-Client) reroutet automatisch.
**Pflicht-Tests:** Integration aller drei Pfade; Playwright-Flow 5.
**Plausibilität:** Nach Wechsel auf GRÖSSERES Fahrzeug ist die neue Route nie
kürzer in der Dauer (Monotonie-Check aus docs/07 §3b, hier live geprüft als Log-Warnung).
