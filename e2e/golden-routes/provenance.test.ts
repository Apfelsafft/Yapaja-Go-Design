/**
 * Unit tests for the offline restriction-provenance logic (`provenance.ts`,
 * E10-T3) AND a hard structural check of the shipped fixture.
 *
 * Two distinct jobs in one file on purpose:
 *  1. the pure parsing/matching rules, proven against hand-built candidates
 *     (no osmium, no PBF, no network);
 *  2. `checkProfilePlausibility` applied to EVERY restriction case actually
 *     in `golden-routes.json`. That second block is the part that turns a
 *     silent-vacuity bug into a red build today — it needs no OSM data, so it
 *     runs in the per-PR LI gate as well.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { describe, it, expect } from 'vitest';
import {
  bboxesIntersect,
  checkProfilePlausibility,
  discover,
  expandBbox,
  parseGeoJsonSeqLine,
  parseTagValue,
  profileDimension,
  reportForCase,
  restrictionCases,
  type OsmWayCandidate,
} from './provenance.js';
import type { Bbox } from './bbox.js';
import type { GoldenRoutesFile, ProfileSpec, RestrictionCase } from './types.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

function loadFixture(): GoldenRoutesFile {
  return JSON.parse(
    readFileSync(resolve(__dirname, '..', 'golden-routes.json'), 'utf-8'),
  ) as GoldenRoutesFile;
}

// --- 1. Tag parsing ---------------------------------------------------------

describe('parseTagValue', () => {
  it('parses the plain metric forms used by the vast majority of ways', () => {
    expect(parseTagValue('3.8', 'maxheight')).toMatchObject({ value: 3.8, unit: 'm' });
    expect(parseTagValue('3.8 m', 'maxheight')).toMatchObject({ value: 3.8, unit: 'm' });
    expect(parseTagValue('2.2m', 'maxwidth')).toMatchObject({ value: 2.2, unit: 'm' });
    expect(parseTagValue('3.5', 'maxweight')).toMatchObject({ value: 3.5, unit: 't' });
    expect(parseTagValue('7.5 t', 'maxweight')).toMatchObject({ value: 7.5, unit: 't' });
  });

  it('normalises cm/kg/lbs/ft into the case units', () => {
    expect(parseTagValue('380 cm', 'maxheight')?.value).toBeCloseTo(3.8, 6);
    expect(parseTagValue('3500 kg', 'maxweight')?.value).toBeCloseTo(3.5, 6);
    expect(parseTagValue('12 ft', 'maxheight')?.value).toBeCloseTo(3.658, 3);
    expect(parseTagValue('7716 lbs', 'maxweight')?.value).toBeCloseTo(3.5, 2);
  });

  it("parses the imperial feet/inch form (12'6\")", () => {
    expect(parseTagValue(`12'6"`, 'maxheight')?.value).toBeCloseTo(3.81, 3);
    expect(parseTagValue(`10'`, 'maxheight')?.value).toBeCloseTo(3.048, 3);
  });

  it('accepts a comma decimal separator (German-tagged data)', () => {
    expect(parseTagValue('3,8', 'maxheight')?.value).toBeCloseTo(3.8, 6);
  });

  it('🔴 refuses to invent a number for non-numeric OSM values', () => {
    for (const raw of ['default', 'none', 'no', 'unsigned', 'below_default', '', '   ', 'yes']) {
      expect(parseTagValue(raw, 'maxheight'), `"${raw}" must not parse`).toBeNull();
    }
  });

  it('rejects unknown units instead of silently assuming the default', () => {
    expect(parseTagValue('3.8 furlong', 'maxheight')).toBeNull();
    expect(parseTagValue('3.5 stone', 'maxweight')).toBeNull();
    // A feet/inch value on a WEIGHT key is nonsense, not 3.81 t.
    expect(parseTagValue(`12'6"`, 'maxweight')).toBeNull();
  });

  it('rejects non-positive and garbage values', () => {
    expect(parseTagValue('0', 'maxheight')).toBeNull();
    expect(parseTagValue('-2', 'maxheight')).toBeNull();
    expect(parseTagValue('abc', 'maxheight')).toBeNull();
  });
});

// --- 2. Geometry helpers ----------------------------------------------------

describe('bbox helpers', () => {
  const box: Bbox = [9.0, 47.0, 9.1, 47.1];

  it('detects overlap, containment and edge-touching', () => {
    expect(bboxesIntersect(box, [9.05, 47.05, 9.2, 47.2])).toBe(true);
    expect(bboxesIntersect(box, [9.02, 47.02, 9.03, 47.03])).toBe(true);
    expect(bboxesIntersect(box, [9.1, 47.1, 9.3, 47.3])).toBe(true); // corner touch
  });

  it('rejects disjoint boxes', () => {
    expect(bboxesIntersect(box, [9.2, 47.0, 9.3, 47.1])).toBe(false);
    expect(bboxesIntersect(box, [9.0, 47.2, 9.1, 47.3])).toBe(false);
  });

  it('expands symmetrically and validates the margin', () => {
    expect(expandBbox(box, 0.01)).toEqual([8.99, 46.99, 9.11, 47.11]);
    expect(expandBbox(box, 0)).toEqual(box);
    expect(() => expandBbox(box, -1)).toThrow(/marginDeg/);
  });
});

describe('parseGeoJsonSeqLine', () => {
  const feature = {
    type: 'Feature',
    properties: { '@id': 'w42', maxheight: '3.8', highway: 'residential', name: 'Testweg' },
    geometry: { type: 'LineString', coordinates: [[9.0, 47.0], [9.01, 47.01]] },
  };

  it('extracts way id, tags and geometry bbox', () => {
    const c = parseGeoJsonSeqLine(JSON.stringify(feature));
    expect(c).not.toBeNull();
    expect(c?.osm_way_id).toBe(42);
    expect(c?.tags.maxheight).toBe('3.8');
    expect(c?.tags.name).toBe('Testweg');
    expect(c?.bbox).toEqual([9.0, 47.0, 9.01, 47.01]);
  });

  it('tolerates the id spellings osmium emits across versions', () => {
    for (const id of [42, '42', 'w42', 'way/42']) {
      const line = JSON.stringify({ ...feature, properties: { ...feature.properties, '@id': id } });
      expect(parseGeoJsonSeqLine(line)?.osm_way_id, `id form ${JSON.stringify(id)}`).toBe(42);
    }
  });

  it('strips the RFC 8142 record separator prefix', () => {
    const line = `\u001e${JSON.stringify(feature)}`;
    expect(parseGeoJsonSeqLine(line)?.osm_way_id).toBe(42);
  });

  it('drops unusable records rather than guessing', () => {
    expect(parseGeoJsonSeqLine('')).toBeNull();
    expect(parseGeoJsonSeqLine('not json')).toBeNull();
    // no id -> cannot serve as provenance
    expect(parseGeoJsonSeqLine(JSON.stringify({ ...feature, properties: { maxheight: '3.8' } }))).toBeNull();
    // no geometry -> cannot be located
    expect(
      parseGeoJsonSeqLine(JSON.stringify({ properties: { '@id': 'w1' }, geometry: null })),
    ).toBeNull();
  });

  it('handles nested (Polygon/MultiLineString) coordinate nesting', () => {
    const poly = {
      properties: { '@id': 'w7', maxwidth: '2.2' },
      geometry: { type: 'Polygon', coordinates: [[[9.0, 47.0], [9.2, 47.0], [9.2, 47.3], [9.0, 47.0]]] },
    };
    expect(parseGeoJsonSeqLine(JSON.stringify(poly))?.bbox).toEqual([9.0, 47.0, 9.2, 47.3]);
  });
});

// --- 3. Case matching -------------------------------------------------------

function profile(overrides: Partial<ProfileSpec> = {}): ProfileSpec {
  return {
    name: 'test',
    height_m: 2.2,
    width_m: 2.0,
    length_m: 5.4,
    weight_t: 2.8,
    avg_speed_kmh: 90,
    hazmat: false,
    avoid: { motorway: false, toll: false, ferry: false, unpaved: false },
    ...overrides,
  };
}

function restrictionCase(overrides: Partial<RestrictionCase> = {}): RestrictionCase {
  return {
    id: 'test-case',
    type: 'restriction',
    region: 'de',
    provenance: 'test',
    origin: { lat: 47.0, lon: 9.0 },
    destination: { lat: 47.1, lon: 9.1 },
    small_profile: profile(),
    large_profile: profile({ height_m: 4.0, width_m: 2.55, weight_t: 12 }),
    forbidden_bbox: [9.0, 47.0, 9.01, 47.01],
    restriction: { kind: 'maxheight', value: 3.8, unit: 'm', osm_way_id: null },
    ...overrides,
  } as RestrictionCase;
}

function candidate(id: number, tags: Record<string, string>, bbox: Bbox): OsmWayCandidate {
  return { osm_way_id: id, tags, bbox };
}

describe('reportForCase', () => {
  const inBox: Bbox = [9.004, 47.004, 9.006, 47.006];
  const farAway: Bbox = [10.0, 48.0, 10.1, 48.1];

  it('confirms a case whose binding tag matches the declared value', () => {
    const r = reportForCase(restrictionCase(), [candidate(11, { maxheight: '3.8' }, inBox)], {
      sourceLabel: 'germany-latest.osm.pbf',
    });
    expect(r.verdict).toBe('confirmed');
    expect(r.binding?.candidate.osm_way_id).toBe(11);
    expect(r.suggestedBlock).toEqual({
      kind: 'maxheight',
      value: 3.8,
      unit: 'm',
      osm_way_id: 11,
      source: expect.stringContaining('way 11'),
    });
  });

  it('🔴 picks the MOST RESTRICTIVE way as binding, not the first one seen', () => {
    const r = reportForCase(restrictionCase(), [
      candidate(11, { maxheight: '4.2' }, inBox),
      candidate(12, { maxheight: '3.8' }, inBox),
      candidate(13, { maxheight: '4.5' }, inBox),
    ]);
    expect(r.binding?.candidate.osm_way_id).toBe(12);
    expect(r.verdict).toBe('confirmed');
  });

  it('reports value_mismatch and proposes the OBSERVED value, not the claimed one', () => {
    const r = reportForCase(restrictionCase(), [candidate(11, { maxheight: '3.2' }, inBox)]);
    expect(r.verdict).toBe('value_mismatch');
    expect(r.suggestedBlock?.value).toBe(3.2);
    expect(r.note).toContain('3.2');
  });

  it('flags ambiguity when several ways are equally binding', () => {
    const r = reportForCase(restrictionCase(), [
      candidate(21, { maxheight: '3.8' }, inBox),
      candidate(22, { maxheight: '3.8' }, inBox),
    ]);
    expect(r.verdict).toBe('ambiguous');
    expect(r.binding?.candidate.osm_way_id).toBe(21);
  });

  it('🔴 emits NO suggested block when nothing was found — never a fabricated way-id', () => {
    const r = reportForCase(restrictionCase(), [candidate(11, { maxheight: '3.8' }, farAway)]);
    expect(r.verdict).toBe('no_candidates');
    expect(r.binding).toBeNull();
    expect(r.suggestedBlock).toBeNull();
    expect(r.note).toContain('discover');
  });

  it('🔴 emits NO suggested block when the tag exists but carries no number', () => {
    const r = reportForCase(restrictionCase(), [candidate(11, { maxheight: 'default' }, inBox)]);
    expect(r.verdict).toBe('no_parsable_value');
    expect(r.suggestedBlock).toBeNull();
  });

  it('ignores tags of a different restriction kind', () => {
    const c = restrictionCase({ restriction: { kind: 'maxwidth', value: 2.2, unit: 'm', osm_way_id: null } });
    const r = reportForCase(c, [candidate(11, { maxheight: '3.8' }, inBox)]);
    expect(r.verdict).toBe('no_candidates');
  });

  it('honours the tag-key priority order (maxheight beats maxheight:physical)', () => {
    const r = reportForCase(restrictionCase(), [
      candidate(11, { maxheight: '3.8', 'maxheight:physical': '3.5' }, inBox),
    ]);
    expect(r.binding?.tagKey).toBe('maxheight');
    expect(r.binding?.parsed.value).toBe(3.8);
  });

  it('finds ways just outside the forbidden box via the search margin', () => {
    const justOutside: Bbox = [9.0105, 47.0105, 9.0106, 47.0106];
    expect(reportForCase(restrictionCase(), [candidate(11, { maxheight: '3.8' }, justOutside)], {
      marginDeg: 0,
    }).verdict).toBe('no_candidates');
    expect(reportForCase(restrictionCase(), [candidate(11, { maxheight: '3.8' }, justOutside)], {
      marginDeg: 0.002,
    }).verdict).toBe('confirmed');
  });
});

describe('discover', () => {
  const box: Bbox = [9.0, 47.0, 9.01, 47.01];

  it('ranks the most binding restrictions first', () => {
    const out = discover(
      [
        candidate(1, { maxheight: '4.0' }, box),
        candidate(2, { maxheight: '2.8', name: 'Unterführung' }, box),
        candidate(3, { maxheight: '3.5' }, box),
      ],
      'maxheight',
    );
    expect(out.map((d) => d.osm_way_id)).toEqual([2, 3, 1]);
    expect(out[0].name).toBe('Unterführung');
  });

  it('filters out-of-range noise (barrier-style micro values, absurd highs)', () => {
    const out = discover(
      [candidate(1, { maxheight: '0.5' }, box), candidate(2, { maxheight: '99' }, box), candidate(3, { maxheight: '3.2' }, box)],
      'maxheight',
    );
    expect(out.map((d) => d.osm_way_id)).toEqual([3]);
  });

  it('respects the result limit', () => {
    const many = Array.from({ length: 50 }, (_, i) => candidate(i + 1, { maxweight: String(3 + i * 0.1) }, box));
    expect(discover(many, 'maxweight', { limit: 5 })).toHaveLength(5);
  });
});

// --- 4. Profile plausibility (no OSM data needed) ---------------------------

describe('profileDimension', () => {
  it('maps each restriction kind onto the dimension it acts on', () => {
    const p = profile({ height_m: 3.3, width_m: 2.35, weight_t: 7.49 });
    expect(profileDimension(p, 'maxheight')).toBe(3.3);
    expect(profileDimension(p, 'maxwidth')).toBe(2.35);
    expect(profileDimension(p, 'maxweight')).toBe(7.49);
  });
});

describe('checkProfilePlausibility', () => {
  it('accepts a case whose profiles straddle the limit', () => {
    expect(checkProfilePlausibility(restrictionCase()).ok).toBe(true);
  });

  it('🔴 rejects a vacuous case where the large profile already fits', () => {
    const c = restrictionCase({ large_profile: profile({ height_m: 3.0 }) });
    const result = checkProfilePlausibility(c);
    expect(result.ok).toBe(false);
    expect(result.problems.join(' ')).toContain('vacuously');
  });

  it('🔴 rejects a case where even the small profile is blocked', () => {
    const c = restrictionCase({ small_profile: profile({ height_m: 3.9 }) });
    const result = checkProfilePlausibility(c);
    expect(result.ok).toBe(false);
    expect(result.problems.join(' ')).toContain('small_profile');
  });

  it('checks the correct dimension per kind (a wide case ignores height)', () => {
    const c = restrictionCase({
      restriction: { kind: 'maxwidth', value: 2.2, unit: 'm', osm_way_id: null },
      small_profile: profile({ width_m: 2.0, height_m: 4.5 }),
      large_profile: profile({ width_m: 2.55, height_m: 2.0 }),
    });
    expect(checkProfilePlausibility(c).ok).toBe(true);
  });
});

// --- 5. The shipped fixture itself ------------------------------------------

describe('golden-routes.json restriction cases', () => {
  const cases = restrictionCases(loadFixture().cases);

  it('exist', () => {
    expect(cases.length).toBeGreaterThanOrEqual(6);
  });

  for (const c of cases) {
    it(`🔴 ${c.id}: profiles straddle its ${c.restriction.kind} limit (non-vacuous in both directions)`, () => {
      const result = checkProfilePlausibility(c);
      expect(result.ok, `${c.id}: ${result.problems.join('; ')}`).toBe(true);
    });

    it(`${c.id}: forbidden_bbox is a well-formed, non-degenerate box`, () => {
      const [minLon, minLat, maxLon, maxLat] = c.forbidden_bbox;
      expect(minLon).toBeLessThan(maxLon);
      expect(minLat).toBeLessThan(maxLat);
      // A box larger than ~0.1° would swallow whole city districts and make
      // the "large profile must not enter" assertion trivially strict.
      expect(maxLon - minLon).toBeLessThan(0.1);
      expect(maxLat - minLat).toBeLessThan(0.1);
    });

    it(`${c.id}: has no fabricated provenance (osm_way_id set <=> case verified)`, () => {
      const hasWayId = typeof c.restriction.osm_way_id === 'number';
      if (c.unverified) {
        expect(
          hasWayId,
          `${c.id} is marked unverified but carries an osm_way_id — either it was confirmed ` +
            `(then drop unverified) or the id was invented (then remove it)`,
        ).toBe(false);
        expect(c.todo, `${c.id}: an unverified case must say what is still missing`).toBeTruthy();
      } else {
        expect(
          hasWayId,
          `${c.id} claims to be verified but has no osm_way_id — a verified restriction case must ` +
            `name the way its evidence rests on`,
        ).toBe(true);
      }
    });
  }
});
