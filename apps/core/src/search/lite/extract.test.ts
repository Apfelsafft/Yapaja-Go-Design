/**
 * E05-T5 mandatory "extraction unit test against a mini fixture" (W-12).
 *
 * NOTE (honesty, per task instructions): this sandbox has no PBF-parsing
 * tooling (no osmium/osmconvert, no node PBF lib) and outbound network to
 * Geofabrik is blocked, so there is no way to obtain or parse a real
 * `.osm.pbf` here -- the full PBF -> GeoJSONSeq pipeline
 * (`osmium tags-filter` + `osmium export`) is CI-only-verified (see the new
 * `lite-search-li-build` job in `.github/workflows/ci.yml`, mirroring
 * `valhalla-li-build`'s CI-only PBF handling). What IS tested here, with
 * real code and no mocks, is everything downstream of that: the tag-
 * filtering/normalization rules this module applies to already-parsed
 * GeoJSON Features (exactly the `osmium export -f geojsonseq` line shape),
 * using a small hand-written fixture that includes Vaduz + Vaduzer Straße +
 * a couple of towns/villages, per the task's own suggested fixture set.
 */
import { describe, it, expect } from 'vitest';
import {
  normalizePlaceFeature,
  normalizeStreetFeature,
  normalizeGeoJsonSeqLine,
  type OsmFeature,
} from './extract.js';

function point(lon: number, lat: number): OsmFeature['geometry'] {
  return { type: 'Point', coordinates: [lon, lat] };
}

describe('normalizePlaceFeature', () => {
  it('normalizes a place=city feature (Vaduz)', () => {
    const feature: OsmFeature = {
      type: 'Feature',
      geometry: point(9.5215, 47.141),
      properties: { place: 'city', name: 'Vaduz', population: '5696' },
    };
    expect(normalizePlaceFeature(feature)).toEqual({
      kind: 'city',
      name: 'Vaduz',
      lat: 47.141,
      lon: 9.5215,
      population: 5696,
    });
  });

  it('normalizes place=town and place=village', () => {
    const town: OsmFeature = {
      geometry: point(9.5, 47.15),
      properties: { place: 'town', name: 'Schaan' },
    };
    const village: OsmFeature = {
      geometry: point(9.53, 47.2),
      properties: { place: 'village', name: 'Triesenberg' },
    };
    expect(normalizePlaceFeature(town)?.kind).toBe('town');
    expect(normalizePlaceFeature(village)?.kind).toBe('village');
  });

  it('rejects place values this index does not index (e.g. hamlet, suburb)', () => {
    const feature: OsmFeature = {
      geometry: point(9.5, 47.1),
      properties: { place: 'hamlet', name: 'Irgendwo' },
    };
    expect(normalizePlaceFeature(feature)).toBeNull();
  });

  it('rejects a feature with no place tag at all', () => {
    const feature: OsmFeature = { geometry: point(9.5, 47.1), properties: { name: 'X' } };
    expect(normalizePlaceFeature(feature)).toBeNull();
  });

  it('rejects a missing/empty name', () => {
    expect(
      normalizePlaceFeature({ geometry: point(9.5, 47.1), properties: { place: 'city' } }),
    ).toBeNull();
    expect(
      normalizePlaceFeature({
        geometry: point(9.5, 47.1),
        properties: { place: 'city', name: '   ' },
      }),
    ).toBeNull();
  });

  it('rejects malformed/out-of-range coordinates', () => {
    expect(
      normalizePlaceFeature({
        geometry: { type: 'Point', coordinates: [999, 47.1] },
        properties: { place: 'city', name: 'X' },
      }),
    ).toBeNull();
    expect(
      normalizePlaceFeature({ geometry: undefined, properties: { place: 'city', name: 'X' } }),
    ).toBeNull();
  });

  it('trims whitespace from the name', () => {
    const feature: OsmFeature = {
      geometry: point(9.5, 47.1),
      properties: { place: 'city', name: '  Vaduz  ' },
    };
    expect(normalizePlaceFeature(feature)?.name).toBe('Vaduz');
  });

  it('omits population when the tag is absent or unparsable', () => {
    expect(
      normalizePlaceFeature({ geometry: point(9.5, 47.1), properties: { place: 'city', name: 'X' } })
        ?.population,
    ).toBeUndefined();
    expect(
      normalizePlaceFeature({
        geometry: point(9.5, 47.1),
        properties: { place: 'city', name: 'X', population: 'unbekannt' },
      })?.population,
    ).toBeUndefined();
  });
});

describe('normalizeStreetFeature', () => {
  it('normalizes a named highway (Vaduzer Straße)', () => {
    const feature: OsmFeature = {
      geometry: point(9.52, 47.145),
      properties: { highway: 'residential', name: 'Vaduzer Straße' },
    };
    expect(normalizeStreetFeature(feature)).toEqual({
      kind: 'street',
      name: 'Vaduzer Straße',
      lat: 47.145,
      lon: 9.52,
    });
  });

  it('rejects an unnamed way (nothing a user could type)', () => {
    const feature: OsmFeature = { geometry: point(9.5, 47.1), properties: { highway: 'residential' } };
    expect(normalizeStreetFeature(feature)).toBeNull();
  });

  it('rejects a feature without a highway tag at all', () => {
    const feature: OsmFeature = { geometry: point(9.5, 47.1), properties: { name: 'Nicht-Strasse' } };
    expect(normalizeStreetFeature(feature)).toBeNull();
  });

  it('rejects structural/non-navigable highway values even when named', () => {
    for (const highway of ['proposed', 'construction', 'platform', 'razed']) {
      expect(
        normalizeStreetFeature({
          geometry: point(9.5, 47.1),
          properties: { highway, name: 'Irrelevant' },
        }),
      ).toBeNull();
    }
  });

  it('accepts common navigable highway values', () => {
    for (const highway of ['residential', 'primary', 'secondary', 'unclassified', 'tertiary', 'living_street']) {
      expect(
        normalizeStreetFeature({
          geometry: point(9.5, 47.1),
          properties: { highway, name: 'Teststrasse' },
        }),
      ).not.toBeNull();
    }
  });
});

describe('coordsFromGeometry (via normalize*Feature) -- centroid fallback', () => {
  it('computes a centroid for a LineString geometry (defensive fallback)', () => {
    const feature: OsmFeature = {
      geometry: {
        type: 'LineString',
        coordinates: [
          [9.50, 47.10],
          [9.52, 47.14],
        ],
      },
      properties: { highway: 'residential', name: 'Lange Strasse' },
    };
    const result = normalizeStreetFeature(feature);
    expect(result).not.toBeNull();
    expect(result?.lon).toBeCloseTo(9.51, 5);
    expect(result?.lat).toBeCloseTo(47.12, 5);
  });

  it('computes a centroid for a Polygon geometry (outer ring only)', () => {
    const feature: OsmFeature = {
      geometry: {
        type: 'Polygon',
        coordinates: [
          [
            [9.50, 47.10],
            [9.52, 47.10],
            [9.52, 47.12],
            [9.50, 47.12],
            [9.50, 47.10], // closing point
          ],
        ],
      },
      properties: { place: 'village', name: 'Flaechen-Dorf' },
    };
    const result = normalizePlaceFeature(feature);
    expect(result).not.toBeNull();
    // Mean of the 5 ring points (closing point included, matches the plain
    // arithmetic-mean documented in extract.ts) -- close to the square's center.
    expect(result?.lon).toBeCloseTo(9.508, 2);
    expect(result?.lat).toBeCloseTo(47.108, 2);
  });

  it('returns null for a geometry with no usable coordinates', () => {
    expect(
      normalizeStreetFeature({
        geometry: { type: 'LineString', coordinates: [] },
        properties: { highway: 'residential', name: 'Leer' },
      }),
    ).toBeNull();
  });
});

describe('normalizeGeoJsonSeqLine', () => {
  const VADUZ_LINE = JSON.stringify({
    type: 'Feature',
    geometry: point(9.5215, 47.141),
    properties: { place: 'city', name: 'Vaduz' },
  });
  const VADUZER_STRASSE_LINE = JSON.stringify({
    type: 'Feature',
    geometry: point(9.522, 47.142),
    properties: { highway: 'residential', name: 'Vaduzer Straße' },
  });

  it('parses a place line with sourceKind "place"', () => {
    expect(normalizeGeoJsonSeqLine(VADUZ_LINE, 'place')).toEqual({
      kind: 'city',
      name: 'Vaduz',
      lat: 47.141,
      lon: 9.5215,
      population: undefined,
    });
  });

  it('parses a street line with sourceKind "street"', () => {
    expect(normalizeGeoJsonSeqLine(VADUZER_STRASSE_LINE, 'street')).toEqual({
      kind: 'street',
      name: 'Vaduzer Straße',
      lat: 47.142,
      lon: 9.522,
    });
  });

  it('a place line fed as sourceKind "street" yields null (no highway tag)', () => {
    expect(normalizeGeoJsonSeqLine(VADUZ_LINE, 'street')).toBeNull();
  });

  // Regression: real `osmium export -f geojsonseq` prefixes every record with
  // an ASCII Record Separator (U+001E, RFC 8142). `String.trim()` does NOT
  // strip it, so without explicit handling JSON.parse throws on every line and
  // the index comes out empty (caught in CI against the real LI PBF: 0/21
  // places, 0/14397 streets). The RS prefix must be tolerated transparently.
  it('parses an osmium geojsonseq line even with the leading RS (U+001E) prefix', () => {
    const RS = String.fromCharCode(0x1e);
    expect(normalizeGeoJsonSeqLine(RS + VADUZ_LINE, 'place')).toEqual({
      kind: 'city',
      name: 'Vaduz',
      lat: 47.141,
      lon: 9.5215,
      population: undefined,
    });
    expect(normalizeGeoJsonSeqLine(RS + VADUZER_STRASSE_LINE, 'street')).toEqual({
      kind: 'street',
      name: 'Vaduzer Straße',
      lat: 47.142,
      lon: 9.522,
    });
  });

  it('returns null for blank lines and malformed JSON, never throws', () => {
    expect(normalizeGeoJsonSeqLine('', 'place')).toBeNull();
    expect(normalizeGeoJsonSeqLine('   ', 'place')).toBeNull();
    expect(() => normalizeGeoJsonSeqLine('{not valid json', 'place')).not.toThrow();
    expect(normalizeGeoJsonSeqLine('{not valid json', 'place')).toBeNull();
    expect(normalizeGeoJsonSeqLine('"just a string"', 'place')).toBeNull();
    expect(normalizeGeoJsonSeqLine('42', 'place')).toBeNull();
  });
});
