/**
 * Unit tests for the 🔴 safety-critical bbox-intersection logic (E03-T5).
 *
 * These are PURE and run locally (no Core, no Valhalla) — they are the part of
 * the Golden-Route suite that is `pnpm golden-routes`-green in the sandbox.
 * They pin the exact grenzfälle docs/07 §3b calls out: a vertex inside the
 * box, a segment crossing a box edge with both endpoints outside, and a
 * segment/geometry completely outside.
 */

import { describe, it, expect } from 'vitest';
import {
  geometryIntersectsBbox,
  normalizeBbox,
  pointInBbox,
  segmentIntersectsBbox,
  type Bbox,
} from './bbox.js';
import { decodePolyline6, type LonLat } from './polyline.js';

// A unit square in [lon, lat] space: lon 0..1, lat 0..1.
const BOX: Bbox = [0, 0, 1, 1];

describe('pointInBbox', () => {
  it('is true for an interior point', () => {
    expect(pointInBbox([0.5, 0.5], BOX)).toBe(true);
  });
  it('is inclusive on the edges and corners', () => {
    expect(pointInBbox([0, 0], BOX)).toBe(true);
    expect(pointInBbox([1, 1], BOX)).toBe(true);
    expect(pointInBbox([0.5, 0], BOX)).toBe(true);
    expect(pointInBbox([0, 0.5], BOX)).toBe(true);
  });
  it('is false just outside', () => {
    expect(pointInBbox([-0.0001, 0.5], BOX)).toBe(false);
    expect(pointInBbox([1.0001, 0.5], BOX)).toBe(false);
    expect(pointInBbox([0.5, -0.0001], BOX)).toBe(false);
    expect(pointInBbox([0.5, 1.0001], BOX)).toBe(false);
  });
});

describe('segmentIntersectsBbox', () => {
  it('true when both endpoints are inside', () => {
    expect(segmentIntersectsBbox([0.2, 0.2], [0.8, 0.8], BOX)).toBe(true);
  });

  it('true when one endpoint is inside and one outside', () => {
    expect(segmentIntersectsBbox([0.5, 0.5], [2, 2], BOX)).toBe(true);
  });

  it('🔴 true when BOTH endpoints are outside but the segment crosses the box', () => {
    // Horizontal line at lat 0.5 from lon -1 to lon 2 slices straight through.
    expect(segmentIntersectsBbox([-1, 0.5], [2, 0.5], BOX)).toBe(true);
    // Diagonal passing corner-to-corner through the interior.
    expect(segmentIntersectsBbox([-0.5, -0.5], [1.5, 1.5], BOX)).toBe(true);
  });

  it('false when the segment misses the box entirely', () => {
    // Passes above the box.
    expect(segmentIntersectsBbox([-1, 2], [2, 2], BOX)).toBe(false);
    // Off to the right.
    expect(segmentIntersectsBbox([1.5, -1], [1.5, 2], BOX)).toBe(false);
    // A diagonal beyond the top-left corner that never reaches the square.
    expect(segmentIntersectsBbox([-1, 0.5], [0.5, 2], BOX)).toBe(false);
  });

  it('handles a grazing segment along an edge as an intersection (inclusive)', () => {
    // Runs exactly along the bottom edge lat=0.
    expect(segmentIntersectsBbox([-1, 0], [2, 0], BOX)).toBe(true);
    // Touches only the corner (0,0).
    expect(segmentIntersectsBbox([-1, -1], [0, 0], BOX)).toBe(true);
  });

  it('treats a degenerate (zero-length) segment as a point test', () => {
    expect(segmentIntersectsBbox([0.5, 0.5], [0.5, 0.5], BOX)).toBe(true);
    expect(segmentIntersectsBbox([5, 5], [5, 5], BOX)).toBe(false);
  });
});

describe('geometryIntersectsBbox', () => {
  it('true if any segment of a polyline enters the box', () => {
    const line: LonLat[] = [
      [-1, -1],
      [-0.5, -0.5],
      [0.5, 0.5], // this vertex is inside
      [2, 2],
    ];
    expect(geometryIntersectsBbox(line, BOX)).toBe(true);
  });

  it('🔴 true when a polyline skips OVER the box between two outside vertices', () => {
    // Neither vertex is inside, but the connecting segment crosses the box —
    // the exact bug a naive "any vertex inside?" check would miss.
    const line: LonLat[] = [
      [-1, 0.5],
      [2, 0.5],
    ];
    expect(geometryIntersectsBbox(line, BOX)).toBe(true);
  });

  it('false for a polyline that stays entirely outside', () => {
    const line: LonLat[] = [
      [-1, -1],
      [-1, 2],
      [-2, 2],
    ];
    expect(geometryIntersectsBbox(line, BOX)).toBe(false);
  });

  it('handles empty and single-point geometries', () => {
    expect(geometryIntersectsBbox([], BOX)).toBe(false);
    expect(geometryIntersectsBbox([[0.5, 0.5]], BOX)).toBe(true);
    expect(geometryIntersectsBbox([[5, 5]], BOX)).toBe(false);
  });

  it('works against a decoded polyline6 fixture (integration with the decoder)', () => {
    // Fixture encodes 4 points around lat 49, lon 8.4 (see web polyline.test.ts).
    const coords = decodePolyline6('_cvm|A_gu_O_dIw_WwvIg~X~lV_rG');
    // A box tightly around the first point (~8.4, 49.0) must be hit.
    const hitBox: Bbox = [8.39, 48.99, 8.41, 49.01];
    expect(geometryIntersectsBbox(coords, hitBox)).toBe(true);
    // A box far away (Atlantic) must not.
    const missBox: Bbox = [-30, 40, -29, 41];
    expect(geometryIntersectsBbox(coords, missBox)).toBe(false);
  });
});

describe('normalizeBbox', () => {
  it('rejects an inverted bbox (min > max)', () => {
    expect(() => normalizeBbox([1, 0, 0, 1])).toThrow();
    expect(() => normalizeBbox([0, 1, 1, 0])).toThrow();
  });
  it('rejects a non-finite bbox', () => {
    expect(() => normalizeBbox([0, 0, Number.NaN, 1])).toThrow();
  });
  it('accepts a well-formed bbox', () => {
    expect(normalizeBbox([0, 0, 1, 1])).toEqual([0, 0, 1, 1]);
  });
});
