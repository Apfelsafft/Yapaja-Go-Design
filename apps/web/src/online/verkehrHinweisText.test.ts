/**
 * Wann Yapaia etwas über die Verkehrslage sagt — und wann es schweigt.
 *
 * ─── DIE ABWÄGUNG, DIE HIER GEPRÜFT WIRD ────────────────────────────────────
 * Ein Hinweis, der bei jeder Fahrt dasteht, wird nach drei Tagen nicht mehr
 * gelesen. Ein Hinweis, der fehlt, wenn die Hälfte der Strecke ungeprüft
 * blieb, ist eine stille Falschauskunft.
 *
 * Beide Fehler sind hier festgehalten: geschwiegen wird im guten Fall,
 * gesprochen genau dann, wenn etwas fehlt.
 */

import { describe, it, expect } from 'vitest';
import { verkehrHinweis } from './verkehrHinweisText';

const FRISCH = { strasse: 'A61', quelle: 'frisch' as const };

describe('verkehrHinweis — Schweigen im guten Fall', () => {
  it('sagt NICHTS, wenn alles frisch da ist', () => {
    expect(verkehrHinweis({ strassen: [FRISCH], ohneOrt: 0, fehler: null })).toBeNull();
  });

  it('sagt auch nichts, wenn gar keine Autobahn auf der Strecke liegt', () => {
    // Eine Landstraßenfahrt soll keinen Hinweis über Autobahndaten bekommen.
    expect(verkehrHinweis({ strassen: [], ohneOrt: 0, fehler: null })).toBeNull();
  });
});

describe('verkehrHinweis — die Warnung hat Vorrang', () => {
  it('nennt eine Autobahn ohne Daten beim Namen', () => {
    const h = verkehrHinweis({
      strassen: [FRISCH, { strasse: 'A3', quelle: 'fehler' }],
      ohneOrt: 0,
      fehler: null,
    });
    expect(h?.stufe).toBe('warnung');
    expect(h?.text).toContain('A3');
    expect(h?.text).toContain('kann etwas sein, das hier nicht steht');
  });

  it('und steht ALLEIN da, nicht hinter zwei anderen Sätzen', () => {
    // Die einzige Lage, in der jemand in etwas hineinfahren kann, das Yapaia
    // hätte wissen können. Sie darf nicht zwischen Nebensätzen untergehen.
    const h = verkehrHinweis({
      strassen: [
        { strasse: 'A3', quelle: 'fehler' },
        { strasse: 'A61', quelle: 'zwischenspeicher', alter_s: 1200 },
      ],
      ohneOrt: 5,
      fehler: null,
    });
    expect(h?.text).not.toContain('Minuten alt');
    expect(h?.text).not.toContain('Ortsangabe');
  });

  it('nennt einen Fehler des Abrufs selbst, wenn keine Straße benannt ist', () => {
    // Etwa: die Online-Dienste sind gar nicht eingeschaltet. Die Meldung des
    // Kerns sagt bereits, wo der Schalter sitzt.
    const h = verkehrHinweis({
      strassen: [],
      ohneOrt: 0,
      fehler: 'Die Online-Dienste sind ausgeschaltet. …enabled',
    });
    expect(h?.stufe).toBe('warnung');
    expect(h?.text).toContain('enabled');
  });
});

describe('verkehrHinweis — das Alter', () => {
  it('nennt es in Minuten', () => {
    const h = verkehrHinweis({
      strassen: [{ strasse: 'A61', quelle: 'zwischenspeicher', alter_s: 1200 }],
      ohneOrt: 0,
      fehler: null,
    });
    expect(h?.stufe).toBe('hinweis');
    expect(h?.text).toContain('etwa 20 Minuten');
  });

  it('sagt „eine Minute" statt „1 Minuten"', () => {
    const h = verkehrHinweis({
      strassen: [{ strasse: 'A61', quelle: 'zwischenspeicher', alter_s: 40 }],
      ohneOrt: 0,
      fehler: null,
    });
    expect(h?.text).toContain('etwa eine Minute');
  });

  it('geht bei viel Alter auf Stunden über', () => {
    // „etwa 185 Minuten" ist eine Zahl, die niemand umrechnet.
    const h = verkehrHinweis({
      strassen: [{ strasse: 'A61', quelle: 'zwischenspeicher', alter_s: 11_100 }],
      ohneOrt: 0,
      fehler: null,
    });
    expect(h?.text).toContain('etwa 3 Stunden');
  });

  it('nimmt den ÄLTESTEN Stand, nicht den ersten', () => {
    // Sonst stünde dort die beruhigendere der beiden Zahlen.
    const h = verkehrHinweis({
      strassen: [
        { strasse: 'A61', quelle: 'zwischenspeicher', alter_s: 120 },
        { strasse: 'A3', quelle: 'zwischenspeicher', alter_s: 1800 },
      ],
      ohneOrt: 0,
      fehler: null,
    });
    expect(h?.text).toContain('etwa 30 Minuten');
  });
});

describe('verkehrHinweis — Meldungen ohne Ort', () => {
  it('werden genannt, wenn sonst alles in Ordnung ist', () => {
    const h = verkehrHinweis({ strassen: [FRISCH], ohneOrt: 3, fehler: null });
    expect(h?.stufe).toBe('hinweis');
    expect(h?.text).toContain('3 Meldung(en) ohne Ortsangabe');
    expect(h?.text).toContain('nicht auf der Karte');
  });

  it('aber treten hinter ein veraltetes Datum zurück', () => {
    // Ein alter Stand betrifft die ganze Strecke; eine ortlose Meldung
    // betrifft einen Punkt. Das Größere zuerst.
    const h = verkehrHinweis({
      strassen: [{ strasse: 'A61', quelle: 'zwischenspeicher', alter_s: 600 }],
      ohneOrt: 3,
      fehler: null,
    });
    expect(h?.text).toContain('Minuten alt');
  });
});
