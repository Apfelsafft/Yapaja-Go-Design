/**
 * Hält die Beschriftung gegen die Schriftdateien, die wir wirklich ausliefern.
 *
 * ─── DER FEHLER, DEN ES HIER GAB ────────────────────────────────────────────
 * Bis 0.3.6 hatten unsere Stile kein `glyphs`. MapLibre zeichnet dann KEINEN
 * Buchstaben — nicht einen. Die Karte führte sechs Symbol-Ebenen (Orte,
 * Straßennamen, Gewässer, Gipfel, POIs) und zeigte von alledem nichts.
 *
 * Belegt, nicht vermutet: im laufenden Browser war `map.getStyle().glyphs`
 * gleich `null`, bei sechs vorhandenen Symbol-Ebenen. Gemeldet wurde es als
 * „die Karten sehen irgendwie langweilig aus" — eine Karte ohne einen
 * einzigen Ortsnamen.
 *
 * ─── WARUM DAS EIN TEST GEGEN DIE PLATTE IST ────────────────────────────────
 * Es gibt hier zwei Arten, still zu scheitern, und keine davon erzeugt einen
 * Fehler, den irgendjemand sieht:
 *
 *   1. `glyphs` fehlt im Stildokument       → gar kein Text.
 *   2. `text-font` nennt einen Schnitt, für den keine Dateien ausgeliefert
 *      werden                               → kein Text auf dieser Ebene,
 *      gemeldet nur in der Browserkonsole.
 *
 * Gegen (2) hilft keine Konstante und keine Typprüfung: entscheidend ist, ob
 * die Datei am Ende im Image liegt. Also wird hier im Dateisystem
 * nachgesehen, im selben Ordner, den Vite nach `apps/web/dist` und das
 * Add-on-Image nach `apps/core/public` kopiert.
 */

import { describe, it, expect } from 'vitest';
import { existsSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildBaseLayers } from './baseLayers';
import { LIGHT_PALETTE, DARK_PALETTE, CONTRAST_PALETTE, OUTDOOR_PALETTE } from './palette';
import { FONT_RANGES, GLYPHS_URL, SHIPPED_FONTS } from './fonts';
import { getStyleDocument, listStyleSummaries } from './registry';

/** `apps/web/public/fonts` — von hier aus vier Ebenen hoch aus `map/styles`. */
const FONTS_DIR = join(
  dirname(fileURLToPath(import.meta.url)),
  '../../../../../apps/web/public/fonts',
);

const ALL_PALETTES = [
  ['hell', LIGHT_PALETTE],
  ['dunkel', DARK_PALETTE],
  ['kontrast', CONTRAST_PALETTE],
  ['natur', OUTDOOR_PALETTE],
] as const;

describe('Kartenbeschriftung — Schriftzeichen', () => {
  // ─── (1) OHNE DAS HIER BLEIBT DIE GANZE KARTE STUMM ───────────────────────
  it('gibt in JEDEM Stil eine Glyphenquelle an', () => {
    for (const { id } of listStyleSummaries()) {
      const style = getStyleDocument(id);
      expect(style, `Stil "${id}" liess sich nicht bauen`).not.toBeNull();
      expect(
        style?.glyphs,
        `Stil "${id}" hat kein "glyphs" — MapLibre zeichnet dann keinen einzigen ` +
          'Buchstaben, ohne jede Fehlermeldung.',
      ).toBeTruthy();
    }
  });

  /** Seitenrelativ, sonst bricht es unter dem HA-Ingress-Unterpfad (W-15) —
   *  dieselbe Regel wie fuer die Kachel-URL in `rewrite.ts`. */
  it('holt die Zeichen seitenrelativ, damit der Ingress-Unterpfad traegt', () => {
    expect(GLYPHS_URL.startsWith('./')).toBe(true);
    expect(GLYPHS_URL).toContain('{fontstack}');
    expect(GLYPHS_URL).toContain('{range}');
  });

  // ─── (2) DER TEIL, DEN NUR DIE PLATTE BEANTWORTEN KANN ────────────────────
  it('liefert zu jedem Schriftschnitt, den ein Stil anfordert, auch Dateien aus', () => {
    const requested = new Set<string>();
    for (const [, palette] of ALL_PALETTES) {
      for (const layer of buildBaseLayers(palette)) {
        if (layer.type !== 'symbol') continue;
        const fonts = layer.layout['text-font'];
        expect(
          Array.isArray(fonts),
          `Ebene "${layer.id}" setzt kein text-font — MapLibre nimmt dann seine ` +
            'Vorgabe ("Open Sans Regular"), die wir nicht ausliefern: kein Text.',
        ).toBe(true);
        for (const font of fonts as string[]) requested.add(font);
      }
    }

    expect(requested.size, 'kein Stil fordert eine Schrift an — Test prueft nichts').toBeGreaterThan(0);

    for (const font of requested) {
      expect(
        (SHIPPED_FONTS as readonly string[]).includes(font),
        `Ein Stil beschriftet mit "${font}", das steht aber nicht in SHIPPED_FONTS.`,
      ).toBe(true);

      for (const [start, end] of FONT_RANGES) {
        const file = join(FONTS_DIR, font, `${start}-${end}.pbf`);
        expect(
          existsSync(file),
          `"${font}" wird auf der Karte verwendet, aber ${start}-${end}.pbf fehlt in ` +
            `apps/web/public/fonts/${font}/. Die Beschriftung bliebe in diesem ` +
            'Zeichenbereich leer — sichtbar nur in der Browserkonsole.',
        ).toBe(true);
        expect(statSync(file).size, `${file} ist leer`).toBeGreaterThan(0);
      }
    }
  });

  /** Der lateinische Grundbereich traegt jeden westeuropaeischen Namen. Faellt
   *  der aus, ist die Karte praktisch unbeschriftet — deshalb einzeln. */
  it('deckt mindestens den lateinischen Grundbereich ab', () => {
    expect(FONT_RANGES.some(([s, e]) => s === 0 && e === 255)).toBe(true);
  });
});
