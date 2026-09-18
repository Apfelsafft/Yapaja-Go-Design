/**
 * Die Karte zeigt ALLES, was installiert ist — eine Wache.
 *
 * ─── WARUM ES DIESE PRÜFUNG GIBT ────────────────────────────────────────────
 * Die Mehrregionen-Karte aus 0.9.1 war vollständig wirkungslos, weil EINE
 * Zeile in `MapView` die Region der aktuellen Position in die Stil-Anfrage
 * schrieb. Gemeldet wurde „Sehe aber nur Deutschland".
 *
 * Eine Mutation hat das danach überlebt: `fetchStyle` war geprüft, die
 * Entscheidung darüber nicht — sie stand in einem React-Baustein, den kein
 * Test berührt. Ein Stil MIT Region ist ein gültiger Stil; die Karte geht auf
 * und sieht richtig aus. Sie ist nur kleiner, als sie sein müsste, und nichts
 * sagt es.
 *
 * ─── SEIT 0.16.0 IST DIE REGEL EINFACHER GEWORDEN ───────────────────────────
 * Bis 0.15.3 gab es eine Ausnahme: die feste Wahl im Kartenmenü durfte eine
 * Region nennen. Diese Wahl ist entfallen — gewünscht:
 *
 *   „Der Anwender soll immer alles angezeigt bekommen was er runtergeladen
 *    hat."
 *
 * Damit lautet die Regel nicht mehr „die richtige Region", sondern
 * **GAR KEINE**. Das ist die Sorte Regel, die eine Quelltext-Wache prüfen
 * kann: `fetchStyle` bekommt zwei Argumente, nie drei.
 *
 * ─── EINE WACHE, KEINE VERHALTENSPRÜFUNG ────────────────────────────────────
 * Quelltext zu lesen ist normalerweise ein schlechtes Zeichen, und diese
 * Prüfung kann auch nur DIESEN einen Fehler fangen, nicht „die Karte zeigt zu
 * wenig" im Allgemeinen. Sie steht hier, weil der Fehler lautlos ist, schon
 * zweimal aufgetreten ist und sich in einer Zeile beschreiben lässt.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

function mapViewQuelle(): string {
  return readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'MapView.tsx'), 'utf8');
}

/**
 * Die `fetchStyle(...)`-Aufrufe im Quelltext, ohne die aus Kommentaren.
 *
 * ─── WARUM DIE KOMMENTARE RAUS MÜSSEN ───────────────────────────────────────
 * Dieselbe Falle ist in diesem Projekt schon zweimal zugeschnappt (bei
 * `geheimnisse.test.ts` und `ingressPfade.test.ts`): wer Quelltext nach einem
 * Muster durchsucht und Kommentare mitliest, VERBIETET, über das Muster zu
 * schreiben. Die Erklärung, warum hier keine Region hingehört, würde die
 * Prüfung auslösen, die sie erklärt.
 */
function fetchStyleAufrufe(quelle: string): string[] {
  const ohneKommentare = quelle
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .filter((zeile) => !zeile.trim().startsWith('//'))
    .join('\n');
  return ohneKommentare.match(/fetchStyle\([^)]*\)/g) ?? [];
}

describe('MapView fragt den Stil ohne Region an', () => {
  it('es gibt überhaupt Aufrufe — sonst wäre die Prüfung wirkungslos', () => {
    // Die Gegenprobe zur ganzen Datei. Ohne sie wäre eine umbenannte oder
    // entfernte Funktion ein grüner Test.
    expect(fetchStyleAufrufe(mapViewQuelle()).length).toBeGreaterThan(0);
  });

  it('kein Aufruf reicht eine Region durch', () => {
    // ─── DIE EIGENTLICHE ZUSICHERUNG ────────────────────────────────────────
    // `fetchStyle(styleId, options)` -- zwei Argumente. Ein drittes ist die
    // Region, und die verkleinert die Karte lautlos auf diese eine.
    for (const aufruf of fetchStyleAufrufe(mapViewQuelle())) {
      const argumente = aufruf.slice('fetchStyle('.length, -1).trim();
      const anzahl = argumente.length === 0 ? 0 : argumente.split(',').length;
      expect(
        anzahl,
        `„${aufruf}" reicht ein drittes Argument durch. Das ist die Region — ` +
          'und dann zeichnet der Kern genau EINE statt aller, ohne jede Meldung.',
      ).toBeLessThanOrEqual(2);
    }
  });

  it('nennt `activeRegionName` in keinem Aufruf', () => {
    // Genau das war der Fehler von 0.9.1. `activeRegionName` ist für „wo bin
    // ich" richtig und für „was wird gezeichnet" falsch.
    for (const aufruf of fetchStyleAufrufe(mapViewQuelle())) {
      expect(aufruf).not.toContain('activeRegionName');
    }
  });

  it('der Stil-Schlüssel trägt keine Region mehr', () => {
    // `styleKey(...)` steuert, WANN neu geladen wird. Stünde dort wieder eine
    // Region, baute die Karte bei jeder Grenzüberfahrt ohne Grund neu auf —
    // mitten in der Navigation.
    //
    // Geprüft wird die Zahl der Argumente. Die DEKLARATION fällt dabei raus:
    // sie steht in derselben Datei, und ihre Parameterliste enthält
    // Typangaben (`styleId: string`), Aufrufe nie. Ohne diese Unterscheidung
    // schlug die Prüfung auf der Definition an, die sie schützen soll.
    const aufrufe = (mapViewQuelle().match(/styleKey\([^)]*\)/g) ?? []).filter(
      (treffer) => !treffer.includes(': '),
    );
    expect(aufrufe.length, 'kein styleKey-Aufruf gefunden').toBeGreaterThan(0);
    for (const aufruf of aufrufe) {
      const argumente = aufruf.slice('styleKey('.length, -1).trim();
      const anzahl = argumente.length === 0 ? 0 : argumente.split(',').length;
      expect(anzahl, `„${aufruf}" setzt wieder eine Region in den Schlüssel.`).toBeLessThanOrEqual(
        2,
      );
    }
  });
});

describe('die Auswahl der Region ist wirklich weg', () => {
  it('das Kartenmenü bietet sie nicht mehr an', () => {
    // Sie bloss auszublenden und den Zustand stehenzulassen, waere die
    // schlechtere Haelfte: ein Wert, den nichts mehr setzt, den aber alles
    // noch liest, ist eine Falle fuer den Naechsten.
    const panel = readFileSync(
      join(dirname(fileURLToPath(import.meta.url)), 'StylePanel.tsx'),
      'utf8',
    );
    expect(panel).not.toContain('setManualRegion');
    expect(panel).not.toContain('region-option-');
  });

  it('der Zustand kennt keine manuelle Wahl mehr', () => {
    const store = readFileSync(
      join(dirname(fileURLToPath(import.meta.url)), 'regionStore.ts'),
      'utf8',
    );
    const ohneKommentare = store
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .split('\n')
      .filter((zeile) => !zeile.trim().startsWith('//'))
      .join('\n');
    expect(ohneKommentare).not.toContain('setManual');
  });
});
