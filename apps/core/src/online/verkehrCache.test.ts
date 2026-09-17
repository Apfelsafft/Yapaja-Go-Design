/**
 * Der Zwischenspeicher für Verkehrsmeldungen.
 *
 * ─── DIE ENTSCHEIDUNG, DIE HIER GEPRÜFT WIRD ────────────────────────────────
 * Ein abgelaufener Eintrag wird nicht weggeworfen, sondern MIT SEINEM ALTER
 * ausgeliefert.
 *
 * Wer auf der A61 steht und kein Netz hat, ist mit einer zwanzig Minuten alten
 * Baustellenmeldung besser bedient als mit einer leeren Karte — eine Baustelle
 * steht Wochen. Aber alte Daten als frische auszugeben wäre genau die Sorte
 * beruhigender Auskunft, die dieses Projekt schon mehrfach teuer bezahlt hat.
 * Deshalb liefert `lies()` immer beides.
 */

import { describe, it, expect } from 'vitest';
import {
  VerkehrCache,
  VERKEHR_FRISCH_MS,
  VERKEHR_HOECHSTALTER_MS,
} from './verkehrCache';
import type { Verkehrsmeldung } from './autobahn';

function meldung(id: string): Verkehrsmeldung {
  return {
    id,
    art: 'baustelle',
    strasse: 'A61',
    titel: 'Fahrbahnverengung',
    beschreibung: '',
    lat: 49.9,
    lon: 7.8,
  };
}

/** Eine steuerbare Uhr — sonst müsste der Test warten. */
function uhr(start = 1_000_000): { jetzt: () => number; weiter: (ms: number) => void } {
  let t = start;
  return { jetzt: () => t, weiter: (ms) => { t += ms; } };
}

describe('VerkehrCache', () => {
  it('liefert `null`, solange nichts drin ist', () => {
    expect(new VerkehrCache().lies('A61')).toBeNull();
  });

  it('gibt frisch Geschriebenes als frisch zurück', () => {
    const c = new VerkehrCache();
    c.schreibe('A61', [meldung('x')]);
    const treffer = c.lies('A61');
    expect(treffer?.frisch).toBe(true);
    expect(treffer?.meldungen).toHaveLength(1);
  });

  it('nennt nach Ablauf das ALTER, statt zu verschweigen oder zu verwerfen', () => {
    // Der Kern der Sache: die Daten sind noch da und noch nützlich, aber der
    // Betreiber muss erfahren, wie alt sie sind.
    const u = uhr();
    const c = new VerkehrCache(u.jetzt);
    c.schreibe('A61', [meldung('x')]);

    u.weiter(VERKEHR_FRISCH_MS + 60_000);
    const treffer = c.lies('A61');
    expect(treffer).not.toBeNull();
    expect(treffer?.frisch).toBe(false);
    expect(treffer?.meldungen).toHaveLength(1);
    expect(treffer?.alterMs).toBe(VERKEHR_FRISCH_MS + 60_000);
  });

  it('genau auf der Grenze gilt noch als frisch', () => {
    // Ein Ab-/Aufrunden an dieser Stelle wäre folgenlos, aber die Grenze soll
    // festgelegt sein und nicht vom Zufall abhängen.
    const u = uhr();
    const c = new VerkehrCache(u.jetzt);
    c.schreibe('A61', [meldung('x')]);
    u.weiter(VERKEHR_FRISCH_MS);
    expect(c.lies('A61')?.frisch).toBe(true);
    u.weiter(1);
    expect(c.lies('A61')?.frisch).toBe(false);
  });

  it('vergisst, was zu alt geworden ist', () => {
    // Sechs Stunden: eine Tagesetappe. Danach ist „ich weiß es nicht"
    // ehrlicher als die Auskunft.
    const u = uhr();
    const c = new VerkehrCache(u.jetzt);
    c.schreibe('A61', [meldung('x')]);
    u.weiter(VERKEHR_HOECHSTALTER_MS + 1);
    expect(c.lies('A61')).toBeNull();
  });

  it('und räumt dabei auf, statt nur `null` zu sagen', () => {
    // Ein Speicher, der nur wächst, läuft irgendwann in genau das Problem,
    // das er vermeiden sollte.
    const u = uhr();
    const c = new VerkehrCache(u.jetzt);
    c.schreibe('A61', [meldung('x')]);
    expect(c.groesse()).toBe(1);
    u.weiter(VERKEHR_HOECHSTALTER_MS + 1);
    c.lies('A61');
    expect(c.groesse()).toBe(0);
  });

  it('hält Straßen auseinander', () => {
    const c = new VerkehrCache();
    c.schreibe('A61', [meldung('a')]);
    c.schreibe('A3', [meldung('b'), meldung('c')]);
    expect(c.lies('A61')?.meldungen).toHaveLength(1);
    expect(c.lies('A3')?.meldungen).toHaveLength(2);
  });

  it('kopiert beim Schreiben — sonst ändert sich der Eintrag hinterher mit', () => {
    // Eine später veränderte Liste würde den Zwischenspeicher lautlos
    // umschreiben. Das wäre ein Fehler, den man nie an der Karte sieht.
    const c = new VerkehrCache();
    const liste = [meldung('x')];
    c.schreibe('A61', liste);
    liste.push(meldung('y'));
    expect(c.lies('A61')?.meldungen).toHaveLength(1);
  });

  it('ein neuer Schreibvorgang setzt das Alter zurück', () => {
    const u = uhr();
    const c = new VerkehrCache(u.jetzt);
    c.schreibe('A61', [meldung('x')]);
    u.weiter(VERKEHR_FRISCH_MS + 1);
    expect(c.lies('A61')?.frisch).toBe(false);
    c.schreibe('A61', [meldung('y')]);
    expect(c.lies('A61')?.frisch).toBe(true);
  });

  it('eine leere Antwort ist ein Ergebnis und kein fehlender Eintrag', () => {
    // „Auf der A3 ist nichts gemeldet" ist eine Auskunft. Würde sie nicht
    // zwischengespeichert, fragte Yapaia genau dort am häufigsten nach —
    // nämlich bei jeder Straße, auf der nichts los ist.
    const c = new VerkehrCache();
    c.schreibe('A3', []);
    const treffer = c.lies('A3');
    expect(treffer).not.toBeNull();
    expect(treffer?.meldungen).toEqual([]);
    expect(treffer?.frisch).toBe(true);
  });
});
