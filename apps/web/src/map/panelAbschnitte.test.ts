/**
 * Was im Karten-Menü offen steht — und wie hoch es damit wird.
 *
 * ─── DER GEMELDETE FALL ─────────────────────────────────────────────────────
 * Zweimal gemeldet, wörtlich gleich: „Das options Menü ist überfrachtet. Man
 * kann die oberen Einträge nicht mehr lesen."
 *
 * Beim ersten Mal wurde nur die Höhe begrenzt. Der Inhalt blieb derselbe, er
 * lief nur nicht mehr aus dem Bild — ein Symptom-Fix.
 *
 * „Überfrachtet" ist kein Maß. Diese Tests machen eine Zahl daraus, damit
 * sich nicht wieder unbemerkt etwas dazulegt.
 */

import { describe, it, expect } from 'vitest';
import {
  panelAbschnitte,
  zeilenBeimOeffnen,
  ZEILEN_HOECHSTENS,
  REGIONEN_NOCH_OFFEN,
} from './panelAbschnitte';

describe('panelAbschnitte — was offen steht', () => {
  it('der Kartenstil ist offen — dafür öffnet man dieses Menü', () => {
    const stil = panelAbschnitte(1).find((a) => a.id === 'stil');
    expect(stil?.offen).toBe(true);
  });

  it('die Region ist offen, wenn es etwas zu wählen gibt', () => {
    // Unterwegs im Grenzgebiet mehrmals am Tag gebraucht.
    const region = panelAbschnitte(3).find((a) => a.id === 'region');
    expect(region?.offen).toBe(true);
  });

  it('die Region FEHLT bei einer einzigen Karte', () => {
    // Ein Bedienelement ohne Wirkung ist schlimmer als keines.
    expect(panelAbschnitte(1).map((a) => a.id)).not.toContain('region');
  });

  it('Darstellung und Gerät sind zugeklappt', () => {
    // Schriftgröße und Links-/Rechtshänder stellt man einmal ein. Sie dürfen
    // nicht den Platz dessen einnehmen, was man täglich braucht.
    for (const id of ['darstellung', 'geraet'] as const) {
      expect(panelAbschnitte(3).find((a) => a.id === id)?.offen, id).toBe(false);
    }
  });

  it('der Kartenstil steht ZUERST', () => {
    // Was man am häufigsten braucht, gehört dorthin, wo der Blick zuerst
    // hinfällt — und nicht unter vier Abschnitte, die man nie anfasst.
    expect(panelAbschnitte(3)[0].id).toBe('stil');
  });

  it('jeder Abschnitt hat eine Überschrift in Worten', () => {
    // Ein durchgerutschter Bezeichner wäre kein Text, sondern ein Schlüssel.
    for (const a of panelAbschnitte(3)) {
      // Worte, kein Bezeichner: Grossbuchstabe am Anfang jedes Wortes
      // oder klein danach — aber kein `snake_case` und kein `camelCase`.
      expect(a.titel, a.id).toMatch(/^[A-ZÄÖÜ][a-zäöüß]*( [A-ZÄÖÜa-zäöüß]+)*$/);
    }
  });
});

describe('zeilenBeimOeffnen — die Zahl statt des Gefühls', () => {
  it('bleibt bei DREI Regionen unter der Grenze', () => {
    // Genau die Lage des Betreibers: germany, liechtenstein, switzerland.
    expect(zeilenBeimOeffnen(4, 3)).toBeLessThanOrEqual(ZEILEN_HOECHSTENS);
  });

  it('bleibt auch bei sechs Regionen und sechs Stilen darunter', () => {
    // Eine Fahrt quer durch Europa. Wenn es DANN nicht mehr passt, passt es
    // genau dann nicht, wenn man es am nötigsten braucht.
    //
    // Dieser Test hat einen Entwurfsfehler gefunden: der erste Aufbau liess
    // die Regionsliste IMMER offen und kam damit auf 17 Zeilen. Die
    // Regionen sind der einzige Abschnitt, der mit den Daten des Betreibers
    // waechst — also klappt er ab fuenf Karten zu.
    expect(zeilenBeimOeffnen(6, 6)).toBeLessThanOrEqual(ZEILEN_HOECHSTENS);
  });

  it('die Regionsliste bleibt bei wenigen Karten offen', () => {
    // Bis vier: der Normalfall, und dort soll der Wechsel EIN Tipp sein.
    expect(panelAbschnitte(REGIONEN_NOCH_OFFEN).find((a) => a.id === 'region')?.offen).toBe(true);
  });

  it('und klappt genau ab einer Karte mehr zu', () => {
    // Die Grenze gehoert festgelegt, nicht dem Zufall ueberlassen.
    expect(
      panelAbschnitte(REGIONEN_NOCH_OFFEN + 1).find((a) => a.id === 'region')?.offen,
    ).toBe(false);
  });

  it('der ALTE Aufbau hätte die Grenze gerissen', () => {
    // Die Gegenprobe: sieben Abschnitte, alle offen. Ohne sie wäre der Test
    // oben nur eine Zahl, die zufällig passt.
    //
    // Alt: Theme(1) + Handedness(1) + Region(1+3+1) + Stil(1+4)
    //      + Sprache(1+3) + Größe(1+2) + POI(1+3) + Einrichtung(1+1) = 25
    const alt = 1 + 1 + (1 + 3 + 1) + (1 + 4) + (1 + 3) + (1 + 2) + (1 + 3) + (1 + 1);
    expect(alt).toBeGreaterThan(ZEILEN_HOECHSTENS);
    expect(zeilenBeimOeffnen(4, 3)).toBeLessThan(alt);
  });

  it('eine einzelne Region spart die ganze Abteilung', () => {
    expect(zeilenBeimOeffnen(4, 1)).toBeLessThan(zeilenBeimOeffnen(4, 3));
  });

  it('zugeklappte Abschnitte zählen nur mit ihrer Überschrift', () => {
    // Sonst wäre das Falten wirkungslos — und genau darum geht es hier.
    // 4 Stile: Überschrift+4, Darstellung 1, Gerät 1 = 7.
    expect(zeilenBeimOeffnen(4, 1)).toBe(7);
  });

  it('die offene Regionsliste zählt „Alle" als eigene Zeile mit', () => {
    // ─── WARUM DIESER TEST NACHTRÄGLICH DAZUKAM ───────────────────────────
    // Alle anderen Prüfungen hier sind OBERGRENZEN. Eine Rechnung, die zu
    // WENIG zählt, macht jede Obergrenze leichter einzuhalten — sie fällt
    // also niemandem auf. Genau das ist passiert: das `+ 1` für den Eintrag
    // „Alle" liess sich streichen, ohne dass ein einziger Test rot wurde.
    // Die einzige exakte Zahl im Rest dieser Datei benutzt eine einzelne
    // Region, und bei der gibt es die Abteilung überhaupt nicht.
    //
    // Eine zu niedrige Rechnung ist hier der gefährliche Fehler: sie meldet
    // ein Menü als passend, das auf dem iPad über den Rand läuft.
    //
    // 4 Stile, 3 Regionen:
    //   Kartenstil        Überschrift + 4 Stile          = 5
    //   Angezeigte Region Überschrift + „Alle" + 3       = 5
    //   Darstellung       Überschrift (zugeklappt)       = 1
    //   Gerät             Überschrift (zugeklappt)       = 1
    expect(zeilenBeimOeffnen(4, 3)).toBe(12);
  });
});
