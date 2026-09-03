/**
 * Namen für angetippte Punkte, gelesen aus den geladenen Vektorkacheln.
 *
 * Der Kern dieser Tests ist NICHT „findet einen Namen" — das ist der leichte
 * Teil. Es ist die Entfernungsgrenze: ohne sie gewinnt der nächstgelegene
 * Name aus dem ganzen geladenen Ausschnitt, und auf einer leeren Fläche wäre
 * das ein Ort viele Kilometer weiter, der dann als Ziel im Panel steht. Ein
 * Name, der plausibel aussieht und falsch ist, ist schlimmer als zwei Zahlen.
 */

import { describe, it, expect } from 'vitest';
import type { Map as MapLibreMap } from 'maplibre-gl';
import {
  featureName,
  nearestVertexDistanceSquared,
  resolvePlaceName,
  MAX_NAME_DISTANCE_DEG,
} from './placeName';

interface FakeFeature {
  properties: Record<string, unknown> | null;
  geometry: { type: string; coordinates: unknown };
}

/** Eine Karte, die nur `querySourceFeatures` kann — genau das, was
 *  `resolvePlaceName` benutzt. */
function fakeMap(byLayer: Record<string, FakeFeature[]>): MapLibreMap {
  return {
    querySourceFeatures: (_source: string, opts?: { sourceLayer?: string }) => {
      const layer = opts?.sourceLayer ?? '';
      if (!(layer in byLayer)) {
        // Genau wie MapLibre bei einer Ebene, die das Archiv nicht führt.
        throw new Error(`no such source layer: ${layer}`);
      }
      return byLayer[layer];
    },
  } as unknown as MapLibreMap;
}

function street(name: string, coords: Array<[number, number]>): FakeFeature {
  return { properties: { name }, geometry: { type: 'LineString', coordinates: coords } };
}

function place(name: string, lon: number, lat: number): FakeFeature {
  return { properties: { name }, geometry: { type: 'Point', coordinates: [lon, lat] } };
}

const TAP = { lat: 47.141, lon: 9.521 };

describe('featureName', () => {
  it('liest `name`', () => {
    expect(featureName(place('Bergstrasse', 0, 0) as never)).toBe('Bergstrasse');
  });

  it('bevorzugt die gewünschte Sprache, wenn sie vorhanden ist', () => {
    const feature = {
      properties: { name: 'Vaduz', 'name_de': 'Vaduz (DE)' },
      geometry: { type: 'Point', coordinates: [0, 0] },
    };
    expect(featureName(feature as never, 'name_de')).toBe('Vaduz (DE)');
  });

  it('fällt auf `name` zurück, wenn die Sprachvariante fehlt', () => {
    expect(featureName(place('Vaduz', 0, 0) as never, 'name_de')).toBe('Vaduz');
  });

  it('liefert null bei fehlendem oder leerem Namen', () => {
    expect(featureName({ properties: null, geometry: { type: 'Point', coordinates: [0, 0] } } as never)).toBeNull();
    expect(featureName({ properties: { name: '   ' }, geometry: { type: 'Point', coordinates: [0, 0] } } as never)).toBeNull();
  });
});

describe('nearestVertexDistanceSquared', () => {
  // Eine Straße ist eine Linie. Ihr Mittelpunkt kann weit weg liegen,
  // während die Linie direkt unter dem Finger verläuft — deshalb der
  // nächste Stützpunkt und nicht der Schwerpunkt.
  it('nimmt den nächsten Stützpunkt einer Linie, nicht den ersten', () => {
    const geometry = {
      type: 'LineString',
      coordinates: [
        [9.6, 47.3],
        [9.521, 47.141],
      ],
    };
    const d = nearestVertexDistanceSquared(geometry as never, TAP);
    expect(d).not.toBeNull();
    expect(Math.sqrt(d as number)).toBeLessThan(1e-6);
  });

  it('kommt mit verschachtelten Polygon-Koordinaten zurecht', () => {
    const geometry = {
      type: 'Polygon',
      coordinates: [[[9.521, 47.141], [9.6, 47.3], [9.7, 47.4]]],
    };
    expect(nearestVertexDistanceSquared(geometry as never, TAP)).toBeCloseTo(0, 10);
  });

  it('liefert null ohne brauchbare Koordinaten', () => {
    expect(nearestVertexDistanceSquared({ type: 'Point' } as never, TAP)).toBeNull();
  });
});

describe('resolvePlaceName', () => {
  it('nennt die Straße unter dem Finger', () => {
    const map = fakeMap({
      transportation_name: [street('Bergstrasse', [[9.521, 47.141]])],
    });
    expect(resolvePlaceName({ map, point: TAP })).toBe('Bergstrasse');
  });

  // ─── DIE EIGENTLICHE ABSICHERUNG ─────────────────────────────────────────
  it('nennt KEINEN Namen, der weiter weg ist als die Grenze', () => {
    const farAway = MAX_NAME_DISTANCE_DEG * 10;
    const map = fakeMap({
      transportation_name: [street('Weit-weg-Strasse', [[9.521 + farAway, 47.141]])],
      poi: [],
      place: [],
    });
    expect(resolvePlaceName({ map, point: TAP })).toBeNull();
  });

  it('zieht die nähere Straße der ferneren vor', () => {
    const map = fakeMap({
      transportation_name: [
        street('Fern', [[9.5215, 47.1415]]),
        street('Nah', [[9.521, 47.141]]),
      ],
    });
    expect(resolvePlaceName({ map, point: TAP })).toBe('Nah');
  });

  // Reihenfolge: Straße ist die genaueste Auskunft über einen Punkt.
  it('bevorzugt die Straße vor dem Ortsnamen', () => {
    const map = fakeMap({
      transportation_name: [street('Bergstrasse', [[9.521, 47.141]])],
      poi: [],
      place: [place('Triesenberg', 9.5215, 47.1415)],
    });
    expect(resolvePlaceName({ map, point: TAP })).toBe('Bergstrasse');
  });

  it('nimmt den Ortsnamen, wenn keine Straße nah genug ist', () => {
    const map = fakeMap({
      transportation_name: [],
      poi: [],
      place: [place('Triesenberg', 9.53, 47.15)],
    });
    expect(resolvePlaceName({ map, point: TAP })).toBe('Triesenberg');
  });

  // Ein Archiv ohne diese Ebenen (Fixture-Kacheln, alter Kachelbau) darf das
  // Setzen eines Ziels nicht verhindern. Ein Name ist Komfort, kein Teil der
  // Navigation.
  it('wirft nicht, wenn es die Ebenen gar nicht gibt', () => {
    const map = fakeMap({});
    expect(resolvePlaceName({ map, point: TAP })).toBeNull();
  });

  it('überspringt Features ohne Namen statt sie zu zählen', () => {
    const map = fakeMap({
      transportation_name: [
        { properties: {}, geometry: { type: 'LineString', coordinates: [[9.521, 47.141]] } },
        street('Bergstrasse', [[9.5211, 47.1411]]),
      ],
    });
    expect(resolvePlaceName({ map, point: TAP })).toBe('Bergstrasse');
  });
});
