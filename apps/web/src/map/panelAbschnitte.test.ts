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
import { panelAbschnitte, zeilenBeimOeffnen, ZEILEN_HOECHSTENS } from './panelAbschnitte';

describe('panelAbschnitte — was offen steht', () => {
  it('der Kartenstil ist offen — dafür öffnet man dieses Menü', () => {
    const stil = panelAbschnitte().find((a) => a.id === 'stil');
    expect(stil?.offen).toBe(true);
  });

  it('die Regionsauswahl gibt es GAR NICHT mehr', () => {
    // ─── SEIT 0.16.0 ────────────────────────────────────────────────────────
    // Hier standen zwei Fälle: „die Region ist offen, wenn es etwas zu wählen
    // gibt" und „die Region FEHLT bei einer einzigen Karte". Gewünscht wurde
    // das Gegenteil von beidem:
    //
    //   „Auch die Auswahl der Region ist dann unnötig da ja immer alles
    //    angezeigt wird."
    //
    // Die Auswahl konnte nur eines: die Karte verkleinern. Ihr bester
    // Zustand war „unberührt".
    expect(panelAbschnitte().map((a) => a.id)).not.toContain('region');
  });

  it('Darstellung und Gerät sind zugeklappt', () => {
    // Schriftgröße und Links-/Rechtshänder stellt man einmal ein. Sie dürfen
    // nicht den Platz dessen einnehmen, was man täglich braucht.
    for (const id of ['darstellung', 'geraet'] as const) {
      expect(panelAbschnitte().find((a) => a.id === id)?.offen, id).toBe(false);
    }
  });

  it('der Kartenstil steht ZUERST', () => {
    // Was man am häufigsten braucht, gehört dorthin, wo der Blick zuerst
    // hinfällt — und nicht unter vier Abschnitte, die man nie anfasst.
    expect(panelAbschnitte()[0].id).toBe('stil');
  });

  it('jeder Abschnitt hat eine Überschrift in Worten', () => {
    // Ein durchgerutschter Bezeichner wäre kein Text, sondern ein Schlüssel.
    for (const a of panelAbschnitte()) {
      // Worte, kein Bezeichner: Grossbuchstabe am Anfang jedes Wortes
      // oder klein danach — aber kein `snake_case` und kein `camelCase`.
      expect(a.titel, a.id).toMatch(/^[A-ZÄÖÜ][a-zäöüß]*( [A-ZÄÖÜa-zäöüß]+)*$/);
    }
  });
});

describe('zeilenBeimOeffnen — die Zahl statt des Gefühls', () => {
  it('bleibt bei vier Stilen weit unter der Grenze', () => {
    expect(zeilenBeimOeffnen(4)).toBeLessThanOrEqual(ZEILEN_HOECHSTENS);
  });

  it('bleibt auch bei sechs Stilen darunter', () => {
    expect(zeilenBeimOeffnen(6)).toBeLessThanOrEqual(ZEILEN_HOECHSTENS);
  });

  it('die Höhe hängt NICHT mehr an der Zahl der Karten', () => {
    // ─── DAS ERGEBNIS DES UMBAUS ────────────────────────────────────────────
    // Die Regionsliste war der einzige Abschnitt, der mit den Daten des
    // Betreibers wuchs — und damit der Grund, aus dem das Menü ausgerechnet
    // auf der langen Fahrt durch mehrere Länder überlief.
    //
    // Diese Prüfung hat keinen Parameter mehr, an dem sie das zeigen könnte.
    // Genau das IST die Aussage: die Funktion kennt die Zahl der Karten
    // nicht mehr. Käme sie zurück, liesse sich diese Zeile nicht mehr
    // übersetzen.
    expect(zeilenBeimOeffnen.length, 'zeilenBeimOeffnen nimmt wieder mehr als die Stile').toBe(1);
  });

  it('der ALTE Aufbau hätte die Grenze gerissen', () => {
    // Die Gegenprobe: sieben Abschnitte, alle offen. Ohne sie wäre die Zahl
    // oben nur eine, die zufällig passt.
    //
    // Alt: Theme(1) + Handedness(1) + Region(1+3+1) + Stil(1+4)
    //      + Sprache(1+3) + Größe(1+2) + POI(1+3) + Einrichtung(1+1) = 25
    const alt = 1 + 1 + (1 + 3 + 1) + (1 + 4) + (1 + 3) + (1 + 2) + (1 + 3) + (1 + 1);
    expect(alt).toBeGreaterThan(ZEILEN_HOECHSTENS);
    expect(zeilenBeimOeffnen(4)).toBeLessThan(alt);
  });

  it('zugeklappte Abschnitte zählen nur mit ihrer Überschrift', () => {
    // Sonst wäre das Falten wirkungslos — und genau darum geht es hier.
    // 4 Stile: Überschrift+4, Darstellung 1, Gerät 1 = 7.
    expect(zeilenBeimOeffnen(4)).toBe(7);
  });

  it('jeder Stil zählt als eigene Zeile', () => {
    // ─── WARUM ES DIESE EXAKTE ZAHL BRAUCHT ─────────────────────────────────
    // Alle Grenzen hier sind OBERgrenzen. Eine Rechnung, die zu WENIG zählt,
    // macht jede Obergrenze leichter einzuhalten — sie fällt also niemandem
    // auf. Genau das ist in einer früheren Fassung passiert: das `+ 1` für
    // den Eintrag „Alle" liess sich streichen, ohne dass ein Test rot wurde.
    //
    // Eine zu niedrige Rechnung ist hier der gefährliche Fehler: sie meldet
    // ein Menü als passend, das auf dem iPad über den Rand läuft.
    expect(zeilenBeimOeffnen(6)).toBe(zeilenBeimOeffnen(4) + 2);
    expect(zeilenBeimOeffnen(0)).toBe(3);
  });
});
