/**
 * Der Bauplan des Routinggraphen.
 *
 * ─── DIE EINE EIGENSCHAFT ───────────────────────────────────────────────────
 * Der Plan darf keine Region verlieren, die schon im Graphen liegt. Genau das
 * ist passiert — drei Länder installiert, beim kleinsten „Routing bauen"
 * gedrückt, danach „no edges found near location" in Köln. Der letzte Test
 * hier prüft das nicht an einem Beispiel, sondern über viele zufällige
 * Ausgangslagen.
 */

import { describe, it, expect } from 'vitest';
import { graphBauPlan, planAlsEnv, GRAPH_PLAN_ENV, type KatalogQuelle } from './graphPlan';

const KATALOG: KatalogQuelle[] = [
  { id: 'germany', pbfUrl: 'https://example.invalid/germany-latest.osm.pbf' },
  { id: 'switzerland', pbfUrl: 'https://example.invalid/switzerland-latest.osm.pbf' },
  { id: 'liechtenstein', pbfUrl: 'https://example.invalid/liechtenstein-latest.osm.pbf' },
];

describe('graphBauPlan', () => {
  it('nimmt JEDE installierte Karte auf, nicht nur die gedrückte', () => {
    // Der gemeldete Fall, wörtlich: germany und switzerland installiert, nur
    // liechtenstein hat einen Extrakt, gedrückt wird germany.
    const plan = graphBauPlan({
      installiert: ['germany', 'liechtenstein', 'switzerland'],
      mitExtrakt: ['liechtenstein'],
      katalog: KATALOG,
      bauRegion: 'germany',
    });
    expect(plan.regionen).toEqual(['germany', 'liechtenstein', 'switzerland']);
    expect(plan.zuLaden.map((z) => z.region)).toEqual(['germany', 'switzerland']);
    expect(plan.ohneQuelle).toEqual([]);
  });

  it('lädt nichts nach, was schon da ist', () => {
    const plan = graphBauPlan({
      installiert: ['germany'],
      mitExtrakt: ['germany'],
      katalog: KATALOG,
      bauRegion: 'germany',
    });
    expect(plan.zuLaden).toEqual([]);
    expect(plan.regionen).toEqual(['germany']);
  });

  it('behält einen Extrakt, dessen Karte gelöscht wurde', () => {
    // Das Skript sammelt das Zwischenlager per Glob ein. Stünde die Region
    // hier nicht im Plan, behauptete der Plan weniger als der Bau tut — und
    // die Warnung „geht verloren" wäre falscher Alarm.
    const plan = graphBauPlan({
      installiert: ['germany'],
      mitExtrakt: ['germany', 'france'],
      katalog: KATALOG,
      bauRegion: 'germany',
    });
    expect(plan.regionen).toContain('france');
  });

  it('nennt eine installierte Karte ohne jede Quelle, statt sie wegzulassen', () => {
    // Eine von Hand nach /share gelegte .pmtiles steht in keinem Katalog.
    // Sie kann nicht ins Routing — das muss DASTEHEN. Eine fehlende Region
    // ist beim Routen sonst nicht von einem Fehler zu unterscheiden.
    const plan = graphBauPlan({
      installiert: ['germany', 'mein-bundesland'],
      mitExtrakt: [],
      katalog: KATALOG,
      bauRegion: 'germany',
    });
    expect(plan.ohneQuelle).toEqual(['mein-bundesland']);
    expect(plan.regionen).not.toContain('mein-bundesland');
  });

  it('verwirft eine Quelle mit Leerraum, statt sie zu zerlegen', () => {
    // Der Plan geht als „<region> <url>" ans Skript. Eine URL mit Leerzeichen
    // zerfiele dort in zwei Felder: ein Download auf einen abgeschnittenen
    // Pfad und eine Region, die lautlos fehlt.
    const plan = graphBauPlan({
      installiert: ['kaputt'],
      mitExtrakt: [],
      katalog: [{ id: 'kaputt', pbfUrl: 'https://example.invalid/mit leerzeichen.osm.pbf' }],
      bauRegion: 'kaputt',
    });
    expect(plan.ohneQuelle).toEqual(['kaputt']);
    expect(plan.zuLaden).toEqual([]);
  });

  it('kommt mit einer Region ohne pbfUrl zurecht', () => {
    const plan = graphBauPlan({
      installiert: ['ohne-url'],
      mitExtrakt: [],
      katalog: [{ id: 'ohne-url', pbfUrl: null }],
      bauRegion: 'ohne-url',
    });
    expect(plan.ohneQuelle).toEqual(['ohne-url']);
  });

  it('liefert sortierte, doppelfreie Regionen', () => {
    const plan = graphBauPlan({
      installiert: ['switzerland', 'germany', 'germany'],
      mitExtrakt: ['germany'],
      katalog: KATALOG,
      bauRegion: 'switzerland',
    });
    expect(plan.regionen).toEqual(['germany', 'switzerland']);
  });
});

describe('planAlsEnv', () => {
  it('schreibt eine Zeile je Extrakt', () => {
    const plan = graphBauPlan({
      installiert: ['germany', 'switzerland'],
      mitExtrakt: [],
      katalog: KATALOG,
      bauRegion: 'germany',
    });
    expect(planAlsEnv(plan).split('\n')).toEqual([
      'germany https://example.invalid/germany-latest.osm.pbf',
      'switzerland https://example.invalid/switzerland-latest.osm.pbf',
    ]);
  });

  it('ist leer, wenn nichts zu laden ist', () => {
    // Eine leere Variable heißt „nichts nachzuladen" und darf NICHT als eine
    // Zeile mit leeren Feldern beim Skript ankommen.
    expect(
      planAlsEnv({ regionen: ['germany'], zuLaden: [], ohneQuelle: [] }),
    ).toBe('');
  });

  it('jede Zeile hat genau zwei Felder', () => {
    const plan = graphBauPlan({
      installiert: ['germany', 'switzerland', 'liechtenstein'],
      mitExtrakt: [],
      katalog: KATALOG,
      bauRegion: 'germany',
    });
    for (const zeile of planAlsEnv(plan).split('\n')) {
      expect(zeile.split(/\s+/)).toHaveLength(2);
    }
  });

  it('der Variablenname steht an einer Stelle', () => {
    expect(GRAPH_PLAN_ENV).toBe('YAPAIA_GRAPH_EXTRAKTE');
  });
});

describe('Eigenschaft: der Plan verliert nie eine vorhandene Region', () => {
  // Der gemeldete Fehler war genau ein Verlust. Ein Beispiel hält so etwas
  // schlecht fest — die nächste Fassung verschiebt die Bedingung, und das
  // Beispiel passt weiter. Deshalb über viele Ausgangslagen.
  const ALLE = ['germany', 'switzerland', 'liechtenstein', 'france', 'austria'];
  const katalog: KatalogQuelle[] = ALLE.map((id) => ({
    id,
    pbfUrl: `https://example.invalid/${id}-latest.osm.pbf`,
  }));

  function teilmenge(seed: number, bits: number): string[] {
    return ALLE.filter((_, i) => ((seed >> (i + bits)) & 1) === 1);
  }

  it('alles, was einen Extrakt hat, ist danach im Graphen', () => {
    for (let seed = 0; seed < 1024; seed += 1) {
      const installiert = teilmenge(seed, 0);
      const mitExtrakt = teilmenge(seed, 5);
      const plan = graphBauPlan({
        installiert,
        mitExtrakt,
        katalog,
        bauRegion: 'germany',
      });
      for (const region of mitExtrakt) {
        expect(plan.regionen, `seed ${seed}: ${region} fiel heraus`).toContain(region);
      }
    }
  });

  it('jede installierte Karte ist danach entweder im Graphen oder benannt', () => {
    // Kein stiller dritter Zustand. Genau der war der Fehler.
    for (let seed = 0; seed < 1024; seed += 1) {
      const installiert = teilmenge(seed, 0);
      const plan = graphBauPlan({
        installiert,
        mitExtrakt: teilmenge(seed, 5),
        katalog,
        bauRegion: 'germany',
      });
      for (const region of installiert) {
        const drin = plan.regionen.includes(region);
        const benannt = plan.ohneQuelle.includes(region);
        expect(drin !== benannt, `seed ${seed}: ${region} weder drin noch benannt`).toBe(true);
      }
    }
  });
});
