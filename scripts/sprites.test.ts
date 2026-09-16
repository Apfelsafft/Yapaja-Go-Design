/**
 * Hält die eingecheckten Schilder gegen den Erzeuger.
 *
 * ─── WOGEGEN ────────────────────────────────────────────────────────────────
 * Die Bilder liegen im Repo und werden von Hand erzeugt (aus demselben Grund
 * wie die Glyphen: das Add-on baut auf dem Gerät des Betreibers, und jeder
 * Schritt dort ist eine Stelle mehr, an der eine Installation scheitern
 * kann).
 *
 * Genau das erzeugt eine eigene Art von stillem Fehler: wer eine Farbe im
 * Quelltext ändert und `node scripts/generate-sprites.mjs` vergisst,
 * bekommt nichts gesagt. Die Karte zeigt monatelang die alte Farbe, und der
 * Quelltext behauptet die neue — bis jemand beides nebeneinanderlegt.
 *
 * Diese Prüfung legt beides nebeneinander.
 *
 * Sie steht in `scripts/`, weil sie den Erzeuger selbst importiert. In
 * `apps/core` ginge das nicht: dessen Typprüfung nimmt kein `.mjs` an. Die
 * Prüfungen gegen den STIL stehen entsprechend dort
 * (`map/styles/shieldSprites.test.ts`).
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  baueBlatt,
  dehnbereiche,
  MASSE,
  OUT_DIR,
  SHIELDS,
  SPRITE_NAME,
} from './generate-sprites.mjs';

interface Schild {
  id: string;
  fuellung: number[];
  rahmen: number[];
  text: string;
}

const ALLE = SHIELDS as Schild[];

describe('Straßenschilder — die Dateien im Repo stammen aus dem Erzeuger', () => {
  it.each([
    ['', 1],
    ['@2x', 2],
  ])('die Beschreibung ist aktuell (%s)', (endung, skala) => {
    const { beschreibung } = baueBlatt(skala as number);
    const eingecheckt = JSON.parse(
      readFileSync(join(OUT_DIR, `${SPRITE_NAME}${endung as string}.json`), 'utf8'),
    );
    expect(
      eingecheckt,
      'weicht ab — läuft `node scripts/generate-sprites.mjs` noch aus?',
    ).toEqual(beschreibung);
  });

  it.each([
    ['', 1],
    ['@2x', 2],
  ])('das Bild ist aktuell (%s)', (endung, skala) => {
    const { png } = baueBlatt(skala as number);
    const eingecheckt = readFileSync(join(OUT_DIR, `${SPRITE_NAME}${endung as string}.png`));
    expect(
      eingecheckt.equals(png),
      'weicht ab — läuft `node scripts/generate-sprites.mjs` noch aus?',
    ).toBe(true);
  });

  it('das erzeugte PNG ist auch wirklich ein PNG', () => {
    // Ein eigener Kodierer ohne Bibliothek: die Signatur zu prüfen kostet
    // nichts und schlägt sofort an, wenn jemand an den Chunks dreht.
    const { png } = baueBlatt(1);
    expect([...png.subarray(0, 8)]).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    expect(png.subarray(12, 16).toString('latin1')).toBe('IHDR');
    expect(png.subarray(png.length - 8, png.length - 4).toString('latin1')).toBe('IEND');
  });

  it('das PNG nennt die Maße, die es auch hat', () => {
    // Ein IHDR, das nicht zum Puffer passt, ergibt in MapLibre ein zerrissenes
    // Bild statt eines Fehlers.
    const { png, blattBreite, hoehe } = baueBlatt(2);
    expect(png.readUInt32BE(16)).toBe(blattBreite);
    expect(png.readUInt32BE(20)).toBe(hoehe);
  });
});

describe('Straßenschilder — die Formen selbst', () => {
  it('jedes Schild hat Rahmen und Füllung in unterschiedlichen Farben', () => {
    // Gleiche Farbe hiesse: kein sichtbarer Rahmen, und genau der war
    // gewünscht.
    for (const s of ALLE) {
      expect(s.rahmen.slice(0, 3), `"${s.id}" hat einen unsichtbaren Rahmen`).not.toEqual(
        s.fuellung.slice(0, 3),
      );
    }
  });

  it('jedes Schild ist vollständig deckend', () => {
    // Ein halbdurchsichtiges Schild ließe die Straße durchscheinen.
    for (const s of ALLE) {
      expect(s.fuellung[3], `"${s.id}" ist nicht deckend`).toBe(255);
      expect(s.rahmen[3], `"${s.id}" hat einen durchsichtigen Rahmen`).toBe(255);
    }
  });

  it('die Textfarbe steht auf ihrem Grund lesbar', () => {
    // Keine Feinheit, nur die grobe Frage: heller Text auf dunklem Grund oder
    // umgekehrt. Schwarz auf Autobahnblau wäre bei Sonne unlesbar, und so ein
    // Fehler entsteht durch eine einzige verrutschte Zeile.
    const helligkeit = (rgb: number[]): number =>
      (rgb[0] * 299 + rgb[1] * 587 + rgb[2] * 114) / 1000;
    for (const s of ALLE) {
      const textIstHell = parseInt(s.text.slice(1, 3), 16) > 0x88;
      const grundIstHell = helligkeit(s.fuellung) > 128;
      expect(textIstHell, `"${s.id}": Text ${s.text} auf ${grundIstHell ? 'hellem' : 'dunklem'} Grund`).toBe(
        !grundIstHell,
      );
    }
  });

  it('die Autobahn ist blau und die Bundesstraße gelb', () => {
    // Der ausdrückliche Wunsch. Ohne diese Zusicherung könnte eine
    // Umsortierung der Liste die Farben vertauschen, ohne dass etwas auffällt.
    const blau = ALLE.find((s) => s.id === 'shield-motorway');
    const gelb = ALLE.find((s) => s.id === 'shield-trunk');
    expect(blau, 'Autobahnschild fehlt').toBeDefined();
    expect(gelb, 'Bundesstraßenschild fehlt').toBeDefined();
    // Blau: Blauanteil deutlich über Rot und Grün.
    expect(blau!.fuellung[2]).toBeGreaterThan(blau!.fuellung[0] + 60);
    expect(blau!.fuellung[2]).toBeGreaterThan(blau!.fuellung[1] + 60);
    // Gelb: Rot und Grün hoch, Blau niedrig.
    expect(gelb!.fuellung[0]).toBeGreaterThan(200);
    expect(gelb!.fuellung[1]).toBeGreaterThan(150);
    expect(gelb!.fuellung[2]).toBeLessThan(100);
  });

  it('der dehnbare Streifen liegt in der Mitte und ist schmal', () => {
    // Würde das ganze Bild gedehnt, würden die runden Ecken bei „A 61" zu
    // Ellipsen. Genau deshalb ist der Streifen schmal.
    for (const skala of [1, 2]) {
      const { stretchX } = dehnbereiche(skala);
      const [von, bis] = stretchX[0];
      const breite = MASSE.breite * skala;
      expect(bis - von, `Skala ${skala}: Dehnstreifen zu breit`).toBeLessThan(breite / 3);
      expect(von, `Skala ${skala}: Dehnstreifen beginnt zu weit links`).toBeGreaterThan(
        MASSE.radius * skala,
      );
      expect(bis, `Skala ${skala}: Dehnstreifen reicht in die rechte Ecke`).toBeLessThan(
        breite - MASSE.radius * skala,
      );
    }
  });

  it('bei doppelter Auflösung verdoppeln sich auch die Maße', () => {
    // Sonst wäre das @2x-Blatt eine andere Form und nicht dieselbe in fein.
    const eins = baueBlatt(1);
    const zwei = baueBlatt(2);
    expect(zwei.hoehe).toBe(eins.hoehe * 2);
    for (const [name, e] of Object.entries(eins.beschreibung)) {
      const z = zwei.beschreibung[name];
      expect(z.width, `${name}: Breite`).toBe((e as { width: number }).width * 2);
      expect(z.pixelRatio, `${name}: pixelRatio`).toBe(2);
    }
  });
});
