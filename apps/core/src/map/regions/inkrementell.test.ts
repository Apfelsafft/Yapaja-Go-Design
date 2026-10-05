/**
 * Nur bauen, was fehlt (0.40.0).
 *
 * Gemeldet: „Wenn ich jetzt noch beispielsweise Österreich dazu lade dann
 * würde ich gerne nur Österreich bauen und nicht alles nochmal. Bei jedem
 * neuen Land wird die Zeit ja immer länger." Und: Ziele in der Schweiz waren
 * nicht anfahrbar, obwohl die Schweizer Karte installiert war.
 */
import { describe, it, expect } from 'vitest';
import { bestandAus, fertigText, noetigerPlan, type Baubestand } from './gesamtbau.js';
import { mitLueckenHinweis } from '../../routing/routes.js';

const T0 = Date.parse('2026-09-19T10:00:00Z');
const SPAETER = Date.parse('2026-10-04T10:00:00Z');

function bestand(teil: Partial<Baubestand> = {}): Baubestand {
  return {
    graphRegionen: ['germany', 'liechtenstein', 'switzerland'],
    graphStand: T0,
    suche: {
      germany: { format: 2, stand: T0 },
      liechtenstein: { format: 2, stand: T0 },
      switzerland: { format: 2, stand: T0 },
    },
    kacheln: { germany: T0 - 1, liechtenstein: T0 - 1, switzerland: T0 - 1 },
    sucheFormat: 2,
    ...teil,
  };
}

describe('noetigerPlan', () => {
  const DREI = ['germany', 'liechtenstein', 'switzerland'];

  it('alles aktuell: nichts zu tun', () => {
    expect(noetigerPlan(DREI, bestand())).toEqual([]);
  });

  it('Österreich dazu: Routing über alle (Grenze!), Suche NUR für Österreich', () => {
    const plan = noetigerPlan([...DREI, 'austria'], bestand({ kacheln: { ...bestand().kacheln, austria: SPAETER } }));
    expect(plan).toEqual([
      { bauart: 'routing', region: 'austria' },
      { bauart: 'suche', region: 'austria' },
    ]);
  });

  it('die Schweiz fehlt im Graphen: Routing wird nachgebaut, die Suche nicht', () => {
    const plan = noetigerPlan(DREI, bestand({ graphRegionen: ['germany', 'liechtenstein'] }));
    expect(plan).toEqual([{ bauart: 'routing', region: 'germany' }]);
  });

  it('ein älterer Suchindex (ohne Firmen/Hausnummern) wird neu gebaut', () => {
    const b = bestand();
    const plan = noetigerPlan(DREI, { ...b, suche: { ...b.suche, germany: { format: 1, stand: T0 } } });
    expect(plan).toEqual([{ bauart: 'suche', region: 'germany' }]);
  });

  it('eine aktualisierte Karte zieht Routing und ihre Suche nach', () => {
    const plan = noetigerPlan(DREI, bestand({ kacheln: { ...bestand().kacheln, switzerland: SPAETER } }));
    expect(plan).toEqual([
      { bauart: 'routing', region: 'germany' },
      { bauart: 'suche', region: 'switzerland' },
    ]);
  });

  it('eine gelöschte Karte: der Graph wird ohne sie neu gebaut', () => {
    expect(noetigerPlan(['germany', 'switzerland'], bestand())).toEqual([{ bauart: 'routing', region: 'germany' }]);
  });

  it('eine Karte ohne OSM-Quelle löst nie wieder Routing aus', () => {
    const plan = noetigerPlan([...DREI, 'handablage'], bestand(), { ohneQuelle: ['handablage'] });
    expect(plan).toEqual([]);
  });

  it('„Alles neu bauen" baut alles', () => {
    expect(noetigerPlan(DREI, bestand(), { alles: true })).toHaveLength(4);
  });

  it('ein Graph, der seine Regionen nicht nennt, wird einmal neu gebaut', () => {
    expect(noetigerPlan(DREI, bestand({ graphRegionen: undefined }))[0]?.bauart).toBe('routing');
  });
});

describe('bestandAus', () => {
  it('liest Baustatus in den Bestand', () => {
    const b = bestandAus(
      {
        tiles: [{ region: 'germany', built_at: '2026-09-04T00:00:00Z' }],
        routing: { present: true, built_at: '2026-09-19T00:00:00Z', regions: ['germany'] },
        search: [{ region: 'germany', built_at: '2026-09-19T00:00:00Z', veraltet: true }],
      },
      2,
    );
    expect(b.graphRegionen).toEqual(['germany']);
    expect(b.suche.germany?.format).toBe(1);
    expect(b.kacheln.germany).toBe(Date.parse('2026-09-04T00:00:00Z'));
  });
});

describe('Texte', () => {
  it('sagt, was gebaut wurde', () => {
    expect(
      fertigText(
        [
          { bauart: 'routing', region: 'austria' },
          { bauart: 'suche', region: 'austria' },
        ],
        ['austria', 'germany'],
      ),
    ).toBe('Gebaut: Routing über 2 Karten und Suche für austria.');
  });

  it('nennt im Routingfehler die fehlende Karte', () => {
    expect(mitLueckenHinweis('Keine Route.', ['switzerland'])).toContain('Im Routing fehlt switzerland');
    expect(mitLueckenHinweis('Keine Route.', [])).toBe('Keine Route.');
  });
});
