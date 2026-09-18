/**
 * Die Messwerte auf der Platte.
 *
 * ─── DIE LEITFRAGE ──────────────────────────────────────────────────────────
 * Kann diese Datei jemals einen Bau verhindern?
 *
 * Sie trägt eine Komfortangabe. Wenn ein unlesbares, kaputtes oder nicht
 * schreibbares `bauzeiten.json` dazu führt, dass ein mehrstündiger Bau nicht
 * startet, ist der Preis grotesk falsch angesetzt.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, readFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  bauzeitenPfad,
  leseErfahrung,
  merkeDauer,
  HOECHSTALTER_MS,
} from './bauzeitSpeicher.js';

let verzeichnis: string;
let pfad: string;

beforeEach(() => {
  verzeichnis = mkdtempSync(join(tmpdir(), 'yapaia-bauzeit-'));
  pfad = join(verzeichnis, 'bauzeiten.json');
});

afterEach(() => {
  rmSync(verzeichnis, { recursive: true, force: true });
});

const JETZT = Date.parse('2026-09-18T12:00:00.000Z');

describe('wo die Datei liegt', () => {
  it('neben dem Kachelverzeichnis, nicht darin', () => {
    // Die Messwerte gehoeren zu keiner einzelnen Karte. Laegen sie im
    // Kachelverzeichnis, waeren sie ausserdem beim Loeschen einer Region in
    // Reichweite.
    expect(bauzeitenPfad('/data/tiles')).toBe(join('/data', 'bauzeiten.json'));
  });
});

describe('lesen', () => {
  it('eine fehlende Datei ist kein Fehler, sondern „noch nie gebaut"', () => {
    expect(leseErfahrung(pfad, JETZT)).toEqual({});
  });

  it('ein frischer Wert kommt durch', () => {
    merkeDauer(pfad, 'suche:germany', 600, JETZT);
    expect(leseErfahrung(pfad, JETZT)).toEqual({ 'suche:germany': 600 });
  });

  it('kaputtes JSON ergibt „nichts", nicht einen Absturz', () => {
    writeFileSync(pfad, '{ das ist kein JSON', 'utf8');
    expect(leseErfahrung(pfad, JETZT)).toEqual({});
  });

  it('eine Liste statt eines Objekts ebenfalls', () => {
    writeFileSync(pfad, '[1, 2, 3]', 'utf8');
    expect(leseErfahrung(pfad, JETZT)).toEqual({});
  });

  it('einzelne kaputte Einträge werfen die GUTEN nicht weg', () => {
    // Sonst kostet ein einziger verhunzter Schluessel alle anderen Messungen
    // mit -- und die sind Stunden wert.
    writeFileSync(
      pfad,
      JSON.stringify({
        'suche:germany': { sekunden: 600, gemessenAm: new Date(JETZT).toISOString() },
        'suche:kaputt': { sekunden: 'viel', gemessenAm: new Date(JETZT).toISOString() },
        'suche:leer': null,
        'suche:ohneZeit': { sekunden: 100 },
      }),
      'utf8',
    );
    expect(leseErfahrung(pfad, JETZT)).toEqual({ 'suche:germany': 600 });
  });

  it('eine Dauer von 0 oder weniger zählt nicht', () => {
    writeFileSync(
      pfad,
      JSON.stringify({
        a: { sekunden: 0, gemessenAm: new Date(JETZT).toISOString() },
        b: { sekunden: -5, gemessenAm: new Date(JETZT).toISOString() },
      }),
      'utf8',
    );
    expect(leseErfahrung(pfad, JETZT)).toEqual({});
  });

  it('ein unlesbarer Zeitstempel macht den Wert unbrauchbar', () => {
    // Ohne ihn laesst sich das Hoechstalter nicht pruefen. Ungeprueft
    // durchzulassen hiesse, die Regel abzuschaffen.
    writeFileSync(pfad, JSON.stringify({ a: { sekunden: 600, gemessenAm: 'neulich' } }), 'utf8');
    expect(leseErfahrung(pfad, JETZT)).toEqual({});
  });
});

describe('das Höchstalter', () => {
  it('ein zu alter Wert wird nicht mehr angeboten', () => {
    // Nach einem halben Jahr hat sich meist etwas geaendert, das die Dauer
    // beeinflusst. „Keine Angabe" ist dann ehrlicher als eine Erinnerung.
    merkeDauer(pfad, 'suche:germany', 600, JETZT - HOECHSTALTER_MS - 1000);
    expect(leseErfahrung(pfad, JETZT)).toEqual({});
  });

  it('knapp darunter gilt er noch', () => {
    // Die Gegenprobe: eine Altersgrenze, die alles verwirft, waere so
    // wertlos wie gar keine.
    merkeDauer(pfad, 'suche:germany', 600, JETZT - HOECHSTALTER_MS + 1000);
    expect(leseErfahrung(pfad, JETZT)).toEqual({ 'suche:germany': 600 });
  });

  it('ein Wert AUS DER ZUKUNFT gilt weiterhin', () => {
    // Kann durch eine verstellte Uhr entstehen. Ihn zu verwerfen, brächte
    // nichts -- er ist ja nicht zu alt.
    merkeDauer(pfad, 'suche:germany', 600, JETZT + 60_000);
    expect(leseErfahrung(pfad, JETZT)).toEqual({ 'suche:germany': 600 });
  });
});

describe('schreiben', () => {
  it('ein zweiter Lauf ERSETZT den ersten, er mittelt nicht', () => {
    // Bewusst so: Geraet, Kartenmenge und Werkzeuge aendern sich ueber die
    // Zeit. Ein Mittelwert aus zwei Zustaenden beschreibt keinen von beiden.
    merkeDauer(pfad, 'suche:germany', 600, JETZT);
    merkeDauer(pfad, 'suche:germany', 900, JETZT);
    expect(leseErfahrung(pfad, JETZT)).toEqual({ 'suche:germany': 900 });
  });

  it('andere Schlüssel bleiben dabei stehen', () => {
    merkeDauer(pfad, 'suche:germany', 600, JETZT);
    merkeDauer(pfad, 'suche:liechtenstein', 60, JETZT);
    expect(leseErfahrung(pfad, JETZT)).toEqual({
      'suche:germany': 600,
      'suche:liechtenstein': 60,
    });
  });

  it('eine unsinnige Dauer wird gar nicht erst abgelegt', () => {
    merkeDauer(pfad, 'a', 0, JETZT);
    merkeDauer(pfad, 'b', -1, JETZT);
    merkeDauer(pfad, 'c', Number.NaN, JETZT);
    expect(leseErfahrung(pfad, JETZT)).toEqual({});
  });

  it('Sekundenbruchteile werden gerundet abgelegt', () => {
    merkeDauer(pfad, 'a', 600.7, JETZT);
    expect(leseErfahrung(pfad, JETZT)).toEqual({ a: 601 });
  });

  it('die Datei bleibt mit blossem Auge lesbar', () => {
    // Sie ist etwas, das jemand im Zweifel von Hand loeschen oder ansehen
    // soll. Eine einzeilige JSON-Wurst waere dafuer das falsche Format.
    merkeDauer(pfad, 'suche:germany', 600, JETZT);
    const inhalt = readFileSync(pfad, 'utf8');
    expect(inhalt).toContain('\n');
    expect(inhalt).toContain('"sekunden": 600');
  });

  it('ein fehlendes Verzeichnis wird angelegt', () => {
    const tiefer = join(verzeichnis, 'gibt', 'es', 'noch', 'nicht', 'bauzeiten.json');
    merkeDauer(tiefer, 'a', 60, JETZT);
    expect(leseErfahrung(tiefer, JETZT)).toEqual({ a: 60 });
  });

  it('hinterlässt keine Temporärdatei', () => {
    merkeDauer(pfad, 'a', 60, JETZT);
    const inhalt = readFileSync(pfad, 'utf8');
    expect(JSON.parse(inhalt)).toHaveProperty('a');
  });
});

describe('was NIE passieren darf', () => {
  it('ein nicht schreibbarer Ort wirft nicht', () => {
    // ─── DER KERN DIESER DATEI ────────────────────────────────────────────
    // Diese Angabe ist Komfort. Wenn sie einen mehrstuendigen Bau verhindern
    // kann, ist der Preis grotesk falsch angesetzt.
    //
    // Ein Verzeichnis dort, wo die Datei hin soll: `writeFileSync` auf einen
    // Pfad, dessen Elternteil eine DATEI ist, scheitert zuverlaessig und
    // ohne Rechte-Gebastel (das als root ohnehin wirkungslos waere).
    const alsDatei = join(verzeichnis, 'blockade');
    writeFileSync(alsDatei, 'ich bin eine Datei', 'utf8');
    const unmoeglich = join(alsDatei, 'bauzeiten.json');
    expect(() => merkeDauer(unmoeglich, 'a', 60, JETZT)).not.toThrow();
    // Und das Lesen davon ebenso wenig.
    expect(() => leseErfahrung(unmoeglich, JETZT)).not.toThrow();
    expect(leseErfahrung(unmoeglich, JETZT)).toEqual({});
  });

  it('ein Verzeichnis statt einer Datei wirft beim Lesen nicht', () => {
    const alsVerzeichnis = join(verzeichnis, 'auch-bauzeiten.json');
    mkdirSync(alsVerzeichnis);
    expect(leseErfahrung(alsVerzeichnis, JETZT)).toEqual({});
  });
});
