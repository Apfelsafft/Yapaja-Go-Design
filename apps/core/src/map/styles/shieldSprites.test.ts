/**
 * Hält die Straßenschilder gegen die Bilddateien, die wir wirklich ausliefern.
 *
 * ─── DIESELBE FALLE WIE BEI DEN SCHRIFTEN, EINE STUFE TIEFER ────────────────
 * `baseLayers.fonts.test.ts` gibt es, weil ein fehlendes `glyphs` die ganze
 * Karte stumm gemacht hat — ohne Fehlermeldung. Bei Bildsymbolen ist es
 * genauso, nur gibt es hier DREI Arten, still zu scheitern:
 *
 *   1. `sprite` fehlt im Stildokument            → gar kein Symbol.
 *   2. `icon-image` nennt einen Namen, den das   → diese eine Ebene bleibt
 *      Blatt nicht führt                            leer, gemeldet nur in der
 *                                                    Browserkonsole.
 *   3. Dem Eintrag fehlen `stretchX`/`content`   → `icon-text-fit` tut
 *                                                    nichts, das Schild bleibt
 *                                                    starr und schneidet die
 *                                                    Nummer ab.
 *
 * Keine davon erzeugt einen Fehler, den jemand sieht. Gegen alle drei hilft
 * nur: im Dateisystem nachsehen und die Namen gegeneinanderhalten.
 *
 * ─── UND EINE VIERTE: ABDRIFT ───────────────────────────────────────────────
 * Die Bilder liegen im Repo und werden von Hand erzeugt
 * (`scripts/generate-sprites.mjs`, aus demselben Grund wie die
 * Glyphen). Wer eine Farbe ändert und das Erzeugen vergisst, bekommt es
 * hier gesagt — sonst zeigte die Karte monatelang die alte Farbe, und der
 * Quelltext behauptete die neue.
 */

import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildBaseLayers } from './baseLayers';
import { LIGHT_PALETTE, DARK_PALETTE, CONTRAST_PALETTE, OUTDOOR_PALETTE } from './palette';
import { SPRITE_URL, SHIELD_ICONS, SHIPPED_ICONS, SHIELD_TEXT_COLORS } from './sprites';
import { VERKEHR_SYMBOLE, VERKEHR_ICONS, VERKEHR_BEZEICHNUNG } from './verkehrSymbole';

/** Alle Bildnamen, die in einem Ausdruck vorkommen. */
function bildnamen(ausdruck: unknown): string[] {
  return (JSON.stringify(ausdruck ?? '').match(/"(?:shield|poi)-[a-z-]+"/g) ?? []).map((r) =>
    r.slice(1, -1),
  );
}
import { listStyleSummaries, getStyleDocument } from './registry';
import { POI_KATEGORIEN } from './poiKategorien';
import { FEHLENDE_KLASSEN } from '../sonderziele/fehlendeKlassen';

/** Muss zu `SPRITE_NAME` in `scripts/generate-sprites.mjs` passen.
 *  Der Abgleich gegen den Erzeuger steht in `scripts/shield-sprites.test.ts`
 *  -- dort, wo `.mjs` importiert werden darf. */
const SPRITE_NAME = 'yapaja';

/** `apps/web/public/sprites` — von hier aus fünf Ebenen hoch. */
const SPRITES_DIR = join(
  dirname(fileURLToPath(import.meta.url)),
  '../../../../../apps/web/public/sprites',
);

interface SpriteEintrag {
  x: number;
  y: number;
  width: number;
  height: number;
  pixelRatio: number;
  stretchX?: number[][];
  stretchY?: number[][];
  content?: number[];
}

function spriteJson(endung = ''): Record<string, SpriteEintrag> {
  return JSON.parse(readFileSync(join(SPRITES_DIR, `${SPRITE_NAME}${endung}.json`), 'utf8'));
}

const ALL_PALETTES = [
  ['hell', LIGHT_PALETTE],
  ['dunkel', DARK_PALETTE],
  ['kontrast', CONTRAST_PALETTE],
  ['outdoor', OUTDOOR_PALETTE],
] as const;

describe('Straßenschilder — Stil gegen die ausgelieferten Bilder', () => {
  // ─── (1) Das Stildokument nennt überhaupt ein Blatt ───────────────────────
  it('JEDER ausgelieferte Stil hat eine `sprite`-Quelle', () => {
    const stile = listStyleSummaries();
    expect(stile.length, 'kein Stil registriert — Test prüft nichts').toBeGreaterThan(0);
    for (const s of stile) {
      const doc = getStyleDocument(s.id);
      expect(doc?.sprite, `Stil "${s.id}" hat kein sprite — er zeigt KEIN Symbol`).toBe(SPRITE_URL);
    }
  });

  // ─── Die Dateien sind wirklich da ────────────────────────────────────────
  it.each(['', '@2x'])('liefert Blatt und Beschreibung aus (%s)', (endung) => {
    for (const art of ['png', 'json']) {
      const pfad = join(SPRITES_DIR, `${SPRITE_NAME}${endung}.${art}`);
      expect(existsSync(pfad), `${pfad} fehlt — MapLibre bekommt kein Bild`).toBe(true);
    }
  });

  it('die URL im Stil zeigt auf genau diese Dateien', () => {
    // Sonst stimmen Dateien und Verweis unabhängig voneinander, und die
    // Prüfung oben wäre ein Selbstgespräch.
    expect(SPRITE_URL.endsWith(`/${SPRITE_NAME}`)).toBe(true);
  });

  // ─── (2) Jedes benutzte Symbol gibt es auch ───────────────────────────────
  it('jedes `icon-image` im Stil kommt im Blatt vor', () => {
    const vorhanden = new Set(Object.keys(spriteJson()));
    for (const [name, palette] of ALL_PALETTES) {
      for (const ebene of buildBaseLayers(palette)) {
        const layout = (ebene as { layout?: Record<string, unknown> }).layout;
        const icon = layout?.['icon-image'];
        if (icon === undefined) continue;
        const namen = bildnamen(icon);
        expect(namen.length, `Ebene "${ebene.id}" nennt kein Bild`).toBeGreaterThan(0);
        for (const n of namen) {
          expect(vorhanden.has(n), `Stil "${name}": Symbol "${n}" fehlt im Blatt`).toBe(true);
        }
      }
    }
  });

  it('jedes ausgelieferte Symbol wird auch benutzt', () => {
    // Die Gegenrichtung. Ein Bild, das niemand nennt, ist totes Gewicht in
    // einem Add-on, das offline auf einem Fahrzeugrechner liegt.
    const benutzt = new Set<string>();
    for (const ebene of buildBaseLayers(LIGHT_PALETTE)) {
      const icon = (ebene as { layout?: Record<string, unknown> }).layout?.['icon-image'];
      for (const n of bildnamen(icon)) benutzt.add(n);
    }
    for (const n of SHIPPED_ICONS) {
      expect(benutzt.has(n), `Symbol "${n}" liegt im Blatt, wird aber nirgends genannt`).toBe(true);
    }
  });

  it('zu jeder POI-Kategorie gibt es ein Bild im Blatt', () => {
    const vorhanden = new Set(Object.keys(spriteJson()));
    for (const k of POI_KATEGORIEN) {
      expect(
        vorhanden.has(k.symbol),
        `Kategorie "${k.name}" nennt "${k.symbol}" — das Blatt führt es nicht. ` +
          'Die Marke bliebe leer, ohne Fehlermeldung.',
      ).toBe(true);
    }
  });

  it('zu jedem Sonderziel aus dem Suchindex gibt es ebenfalls ein Bild', () => {
    // Seit 0.13.0 gibt es eine ZWEITE Quelle für POI-Marken: die Kategorien,
    // die das Kachelschema gar nicht führen kann (Entsorgungsstation,
    // Müllentsorgung) und die deshalb aus `lite_search-<region>.db` kommen.
    // Für sie gilt dasselbe wie für die anderen — ein fehlendes Bild zeichnet
    // MapLibre als NICHTS, ohne eine Meldung.
    const vorhanden = new Set(Object.keys(spriteJson()));
    for (const k of FEHLENDE_KLASSEN) {
      expect(
        vorhanden.has(k.symbol),
        `Sonderziel "${k.name}" nennt "${k.symbol}" — das Blatt führt es nicht.`,
      ).toBe(true);
    }
  });

  it('jedes POI-Bild im Blatt gehört auch zu einer Kategorie', () => {
    // Die Gegenrichtung: ein Bild, das niemand nennt, ist totes Gewicht in
    // einem Add-on, das offline auf einem Fahrzeugrechner liegt.
    //
    // BEIDE Quellen zählen. Beim Zufügen der Sonderziele ist genau dieser
    // Test rot geworden und hat gefragt, wer „poi-entsorgung" eigentlich
    // nennt — das ist seine Aufgabe, und er hat sie getan.
    const genannt = new Set([
      ...POI_KATEGORIEN.map((k) => k.symbol),
      ...FEHLENDE_KLASSEN.map((k) => k.symbol),
    ]);
    for (const name of Object.keys(spriteJson())) {
      if (!name.startsWith('poi-')) continue;
      expect(genannt.has(name), `"${name}" liegt im Blatt, keine Kategorie nennt es`).toBe(true);
    }
  });

  it('die beiden Quellen benutzen kein Bild doppelt', () => {
    // Ein gemeinsames Bild hiesse: auf der Karte sind eine Tankstelle aus der
    // Kachel und eine Entsorgungsstation aus dem Index dasselbe Ding.
    const ausKacheln = new Set(POI_KATEGORIEN.map((k) => k.symbol));
    for (const k of FEHLENDE_KLASSEN) {
      expect(
        ausKacheln.has(k.symbol),
        `"${k.symbol}" wird von beiden Quellen benutzt`,
      ).toBe(false);
    }
  });

  // ─── (3) Ohne Dehnbereiche tut `icon-text-fit` nichts ─────────────────────
  it.each(['', '@2x'])('jedes SCHILD darf sich dehnen und weiß, wo der Text hingehört (%s)', (e) => {
    for (const [name, eintrag] of Object.entries(spriteJson(e))) {
      if (!name.startsWith('shield-')) continue;
      expect(eintrag.stretchX?.length, `"${name}" ohne stretchX — das Schild bliebe starr`)
        .toBeGreaterThan(0);
      expect(eintrag.stretchY?.length, `"${name}" ohne stretchY`).toBeGreaterThan(0);
      expect(eintrag.content?.length, `"${name}" ohne content — der Text säße irgendwo`).toBe(4);
    }
  });

  it('eine POI-Marke hat KEINE Dehnbereiche', () => {
    // Sonst zöge `icon-text-fit` sie zu einer Ellipse -- die Marke trägt
    // keinen Text, sie soll rund bleiben.
    for (const [name, e] of Object.entries(spriteJson())) {
      if (!name.startsWith('poi-')) continue;
      expect(e.stretchX, `"${name}" ist dehnbar, obwohl sie rund bleiben soll`).toBeUndefined();
      expect(e.content, `"${name}" hat einen Textbereich, trägt aber keinen Text`).toBeUndefined();
    }
  });

  it('eine POI-Marke ist quadratisch', () => {
    // Eine Scheibe mit ungleichen Seiten wäre ein Ei.
    for (const [name, e] of Object.entries(spriteJson())) {
      if (!name.startsWith('poi-')) continue;
      expect(e.width, `"${name}" ist nicht quadratisch`).toBe(e.height);
    }
  });

  it('der Textbereich liegt INNERHALB des Schilds', () => {
    // Ein content-Rechteck über den Bildrand hinaus schiebt die Nummer aus
    // dem Rahmen heraus -- und sieht aus wie ein Zufall, nicht wie ein Fehler.
    for (const [name, e] of Object.entries(spriteJson())) {
      if (!name.startsWith('shield-')) continue;
      const [x0, y0, x1, y1] = e.content as number[];
      expect(x0, `${name}: content beginnt links vom Bild`).toBeGreaterThanOrEqual(0);
      expect(y0, `${name}: content beginnt über dem Bild`).toBeGreaterThanOrEqual(0);
      expect(x1, `${name}: content endet rechts vom Bild`).toBeLessThanOrEqual(e.width);
      expect(y1, `${name}: content endet unter dem Bild`).toBeLessThanOrEqual(e.height);
      expect(x1).toBeGreaterThan(x0);
      expect(y1).toBeGreaterThan(y0);
    }
  });

  it('die Symbole überlappen sich im Blatt nicht', () => {
    // Überlappende Kästen zeigen Teile des Nachbarsymbols -- sofort sichtbar
    // auf der Karte, aber leicht zu übersehen, solange man nur den Quelltext
    // liest.
    //
    // Diese Prüfung verglich bis 0.9.0 nur WAAGERECHT. Das genügte, solange
    // alles in einer Zeile lag -- mit der zweiten Zeile für die POI-Marken
    // hätte sie eine echte Überlappung durchgelassen. Jetzt vergleicht sie
    // beide Achsen.
    const alle = Object.entries(spriteJson());
    for (const [n1, a] of alle) {
      for (const [n2, b] of alle) {
        if (n1 >= n2) continue;
        const getrennt =
          a.x + a.width <= b.x ||
          b.x + b.width <= a.x ||
          a.y + a.height <= b.y ||
          b.y + b.height <= a.y;
        expect(getrennt, `"${n1}" und "${n2}" überlappen sich im Blatt`).toBe(true);
      }
    }
  });

  // ─── Die Farben hängen zusammen ───────────────────────────────────────────
  it('zu jedem Schild gibt es eine Textfarbe und umgekehrt', () => {
    expect(Object.keys(SHIELD_TEXT_COLORS).sort()).toEqual(Object.keys(SHIELD_ICONS).sort());
  });

});

/**
 * ─── DIE SYMBOLE DER VERKEHRSLAGE ───────────────────────────────────────────
 *
 * Dieselbe Falle wie bei den Schildern und den POIs, zum dritten Mal: ein
 * `icon-image`, das im Blatt nicht vorkommt, ist KEIN Fehler — die Ebene
 * bleibt einfach leer. MapLibre sagt dazu nichts.
 *
 * Deshalb hält dieser Block beide Richtungen gegeneinander: jedes benannte
 * Symbol liegt im Blatt, und jedes Bild im Blatt wird auch benannt.
 */
describe('Verkehrssymbole', () => {
  it('zu jeder Meldungsart gibt es ein Bild im Blatt', () => {
    const vorhanden = new Set(Object.keys(spriteJson()));
    for (const [art, symbol] of Object.entries(VERKEHR_SYMBOLE)) {
      expect(
        vorhanden.has(symbol),
        `Die Art "${art}" nennt "${symbol}" — das Blatt führt es nicht. ` +
          'Die Meldung bliebe unsichtbar, ohne Fehlermeldung.',
      ).toBe(true);
    }
  });

  it('jedes verkehr-Bild im Blatt gehört auch zu einer Art', () => {
    // Totes Gewicht in einem Add-on, das offline auf einem Fahrzeugrechner
    // liegt — und schlimmer: ein Hinweis darauf, dass eine Art vergessen
    // wurde.
    const genannt = new Set<string>(VERKEHR_ICONS);
    for (const name of Object.keys(spriteJson())) {
      if (!name.startsWith('verkehr-')) continue;
      expect(genannt.has(name), `"${name}" liegt im Blatt, wird aber nirgends genannt`).toBe(true);
    }
  });

  it('auch im @2x-Blatt', () => {
    // Auf dem iPad wird das feine Blatt geladen. Fehlte dort ein Symbol,
    // wäre die Meldung genau auf dem Gerät unsichtbar, auf dem getestet wird.
    const fein = new Set(Object.keys(spriteJson('@2x')));
    for (const symbol of VERKEHR_ICONS) {
      expect(fein.has(symbol), `"${symbol}" fehlt im @2x-Blatt`).toBe(true);
    }
  });

  it('Verkehrssymbole heißen nicht wie POI-Symbole', () => {
    // Eine Baustelle ist kein Ort, den man ansteuert. Gerieten die Namen
    // durcheinander, zeigte die POI-Ebene Baustellen und umgekehrt — und
    // beides sähe aus, als sei es so gemeint.
    for (const name of VERKEHR_ICONS) {
      expect(name.startsWith('verkehr-'), `"${name}" folgt nicht der Namensregel`).toBe(true);
    }
  });

  it('die Bezeichnung ist ein WORT und kein Bezeichner', () => {
    // Sie steht in der Oberfläche. Ein `verkehr-baustelle` dort wäre kein
    // Text, sondern ein durchgerutschter Schlüssel.
    for (const wort of Object.values(VERKEHR_BEZEICHNUNG)) {
      expect(wort).toMatch(/^[A-ZÄÖÜ][a-zäöüß]+$/);
    }
  });
});
