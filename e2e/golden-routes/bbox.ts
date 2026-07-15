/**
 * 🔴 SAFETY-CRITICAL geometry: does a route polyline enter a forbidden box?
 *
 * The restriction golden-routes assert that a route computed for a LARGE/heavy
 * profile never enters the bounding box around a physical restriction (a low
 * bridge, a weak bridge, a narrow underpass), while the route for a SMALL
 * profile does. The whole assertion hinges on this one function being correct,
 * so it is a pure, exhaustively unit-tested module (see `bbox.test.ts`) rather
 * than inline test glue.
 *
 * Coordinates are `[lon, lat]` (GeoJSON order, as produced by `decodePolyline6`).
 * A bbox is `[minLon, minLat, maxLon, maxLat]`.
 *
 * "Intersects" is treated INCLUSIVELY: a vertex exactly on an edge, or a
 * segment that merely grazes the box boundary, counts as an intersection. For
 * a safety gate you want the box to catch *touching*, not only strict interior
 * crossing -- erring towards "route flagged as entering the forbidden zone" is
 * the fail-safe direction.
 */

import type { LonLat } from './polyline.js';

/** `[minLon, minLat, maxLon, maxLat]`. */
export type Bbox = [number, number, number, number];

/** Validates and normalises a bbox; throws on a malformed one (safety: never
 * silently test against a degenerate/empty box that can't catch anything). */
export function normalizeBbox(bbox: Bbox): Bbox {
  const [minLon, minLat, maxLon, maxLat] = bbox;
  for (const v of bbox) {
    if (!Number.isFinite(v)) {
      throw new Error(`bbox contains a non-finite value: ${JSON.stringify(bbox)}`);
    }
  }
  if (minLon > maxLon || minLat > maxLat) {
    throw new Error(
      `bbox min must be <= max, got [${minLon}, ${minLat}, ${maxLon}, ${maxLat}]`,
    );
  }
  return bbox;
}

/** True when the point lies inside the closed box (edges included). */
export function pointInBbox(point: LonLat, bbox: Bbox): boolean {
  const [minLon, minLat, maxLon, maxLat] = bbox;
  const [lon, lat] = point;
  return lon >= minLon && lon <= maxLon && lat >= minLat && lat <= maxLat;
}

/**
 * True when the closed segment `a`—`b` intersects the closed box.
 *
 * Liang–Barsky parametric clip: walk the segment as `p = a + t*(b-a)`,
 * `t ∈ [0, 1]`, and shrink the valid `t`-window against each of the four box
 * slabs. If the window stays non-empty the segment touches or crosses the box.
 * Handles the cases inline-code usually gets wrong: both endpoints outside but
 * the segment still crossing a corner/edge, and a zero-length (degenerate)
 * segment.
 */
export function segmentIntersectsBbox(a: LonLat, b: LonLat, bbox: Bbox): boolean {
  const [minLon, minLat, maxLon, maxLat] = bbox;
  const [x0, y0] = a;
  const [x1, y1] = b;

  // Degenerate segment: it's a point.
  if (x0 === x1 && y0 === y1) {
    return pointInBbox(a, bbox);
  }

  const dx = x1 - x0;
  const dy = y1 - y0;

  // Each edge as (p, q): the constraint is `p * t <= q`.
  const p = [-dx, dx, -dy, dy];
  const q = [x0 - minLon, maxLon - x0, y0 - minLat, maxLat - y0];

  let tMin = 0;
  let tMax = 1;

  for (let i = 0; i < 4; i++) {
    if (p[i] === 0) {
      // Segment is parallel to this slab; if it starts outside it, no hit.
      if (q[i] < 0) {
        return false;
      }
      continue;
    }
    const t = q[i] / p[i];
    if (p[i] < 0) {
      // Entering the slab: raises the lower bound.
      if (t > tMin) tMin = t;
    } else {
      // Leaving the slab: lowers the upper bound.
      if (t < tMax) tMax = t;
    }
    if (tMin > tMax) {
      return false;
    }
  }

  return true;
}

/**
 * 🔴 The safety predicate. True when ANY part of the route geometry enters the
 * forbidden box: any vertex inside, or any segment crossing it. A single-point
 * geometry is handled as a point test.
 */
export function geometryIntersectsBbox(coords: readonly LonLat[], bbox: Bbox): boolean {
  normalizeBbox(bbox);

  if (coords.length === 0) {
    return false;
  }
  if (coords.length === 1) {
    return pointInBbox(coords[0], bbox);
  }

  for (let i = 0; i < coords.length - 1; i++) {
    if (segmentIntersectsBbox(coords[i], coords[i + 1], bbox)) {
      return true;
    }
  }
  return false;
}
