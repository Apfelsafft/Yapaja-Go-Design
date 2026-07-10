/**
 * Track model (E02-T4): a track is a sequence of waypoints with cumulative
 * distance and cumulative *simulated* time, sampleable at any point in time
 * to get an interpolated position/speed/heading. Built from either GPX
 * track points (respecting <time> if present, else derived from a target
 * speed) or a polyline6 + speed profile.
 */

import { bearingDeg, destinationPoint, haversineDistanceM, interpolateLatLon, type LatLon } from './geo.js';
import type { GpxTrackPoint } from './gpx.js';

export interface TrackPoint extends LatLon {
  /** Elevation in meters, or null if unknown. */
  ele: number | null;
  /** Cumulative distance in meters from the track start to this point. */
  cumDistanceM: number;
  /** Cumulative simulated time in seconds from the track start to this point. */
  cumTimeS: number;
}

export interface Track {
  points: TrackPoint[];
  totalDistanceM: number;
  totalDurationS: number;
}

/** Default speed (m/s) used when a GPX track has no <time> stamps and no explicit speed was given. ~45 km/h. */
export const DEFAULT_FALLBACK_SPEED_MS = 12.5;

export interface SpeedProfileConstant {
  kind: 'constant';
  /** Target average speed in m/s, applied to every segment. */
  speedMs: number;
}

export interface SpeedProfileList {
  kind: 'list';
  /** One speed (m/s) per segment; length must equal points.length - 1. */
  speedsMs: number[];
}

export type SpeedProfile = SpeedProfileConstant | SpeedProfileList;

function assertFiniteTrack(track: Track): void {
  for (const p of track.points) {
    if (!Number.isFinite(p.lat) || !Number.isFinite(p.lon)) {
      throw new Error('Track contains a non-finite coordinate');
    }
  }
}

/**
 * Build a Track from raw waypoints, deriving each segment's duration from
 * `segmentSpeedsMs[i]` (distance / speed) -- used both for polyline+profile
 * tracks and for the "no <time> stamps" GPX fallback path.
 */
function buildFromWaypointsWithSpeeds(
  waypoints: readonly LatLon[],
  eles: readonly (number | null)[],
  segmentSpeedsMs: readonly number[],
): Track {
  const points: TrackPoint[] = [{ ...waypoints[0], ele: eles[0] ?? null, cumDistanceM: 0, cumTimeS: 0 }];
  let cumDistanceM = 0;
  let cumTimeS = 0;
  for (let i = 1; i < waypoints.length; i++) {
    const segDistanceM = haversineDistanceM(waypoints[i - 1], waypoints[i]);
    const speedMs = segmentSpeedsMs[i - 1];
    if (!(speedMs > 0)) {
      throw new Error(`Track segment ${i - 1} has non-positive speed (${speedMs} m/s)`);
    }
    cumDistanceM += segDistanceM;
    cumTimeS += segDistanceM / speedMs;
    points.push({ ...waypoints[i], ele: eles[i] ?? null, cumDistanceM, cumTimeS });
  }
  const track: Track = { points, totalDistanceM: cumDistanceM, totalDurationS: cumTimeS };
  assertFiniteTrack(track);
  return track;
}

/**
 * Build a Track from raw waypoints using each point's own elapsed real time
 * (GPX <time> respected verbatim, per docs/07 §2: "Bei GPX mit time-Stamps
 * diese respektieren").
 */
function buildFromWaypointsWithTimes(
  waypoints: readonly LatLon[],
  eles: readonly (number | null)[],
  timesMs: readonly number[],
): Track {
  const startMs = timesMs[0];
  const points: TrackPoint[] = [{ ...waypoints[0], ele: eles[0] ?? null, cumDistanceM: 0, cumTimeS: 0 }];
  let cumDistanceM = 0;
  for (let i = 1; i < waypoints.length; i++) {
    const segDistanceM = haversineDistanceM(waypoints[i - 1], waypoints[i]);
    const cumTimeS = (timesMs[i] - startMs) / 1000;
    if (cumTimeS <= points[i - 1].cumTimeS) {
      throw new Error(
        `GPX <time> values must be strictly increasing (point ${i} does not advance past point ${i - 1})`,
      );
    }
    cumDistanceM += segDistanceM;
    points.push({ ...waypoints[i], ele: eles[i] ?? null, cumDistanceM, cumTimeS });
  }
  const track: Track = {
    points,
    totalDistanceM: cumDistanceM,
    totalDurationS: points[points.length - 1].cumTimeS,
  };
  assertFiniteTrack(track);
  return track;
}

export interface GpxTrackOptions {
  /** Used only when the GPX has no <time> stamps on (all) points. Default DEFAULT_FALLBACK_SPEED_MS. */
  fallbackSpeedMs?: number;
}

/** Build a Track from parsed GPX track points. */
export function buildTrackFromGpx(gpxPoints: readonly GpxTrackPoint[], opts: GpxTrackOptions = {}): Track {
  if (gpxPoints.length < 2) {
    throw new Error('buildTrackFromGpx requires at least 2 points');
  }
  const waypoints = gpxPoints.map((p) => ({ lat: p.lat, lon: p.lon }));
  const eles = gpxPoints.map((p) => p.ele);
  const allHaveTime = gpxPoints.every((p) => p.time !== null);

  if (allHaveTime) {
    const timesMs = gpxPoints.map((p) => {
      const ms = Date.parse(p.time as string);
      if (!Number.isFinite(ms)) {
        throw new Error(`GPX <time> value is not a parseable date: "${p.time}"`);
      }
      return ms;
    });
    return buildFromWaypointsWithTimes(waypoints, eles, timesMs);
  }

  const fallbackSpeedMs = opts.fallbackSpeedMs ?? DEFAULT_FALLBACK_SPEED_MS;
  const segmentSpeedsMs = new Array(waypoints.length - 1).fill(fallbackSpeedMs) as number[];
  return buildFromWaypointsWithSpeeds(waypoints, eles, segmentSpeedsMs);
}

/** Build a Track from a decoded polyline6 point list + a speed profile. */
export function buildTrackFromPolyline(waypoints: readonly LatLon[], profile: SpeedProfile): Track {
  if (waypoints.length < 2) {
    throw new Error('buildTrackFromPolyline requires at least 2 points');
  }
  const eles = waypoints.map(() => null);
  const segmentSpeedsMs =
    profile.kind === 'constant'
      ? (new Array(waypoints.length - 1).fill(profile.speedMs) as number[])
      : profile.speedsMs;

  if (segmentSpeedsMs.length !== waypoints.length - 1) {
    throw new Error(
      `Speed profile list has ${segmentSpeedsMs.length} entries, expected ${waypoints.length - 1} (one per segment)`,
    );
  }
  return buildFromWaypointsWithSpeeds(waypoints, eles, segmentSpeedsMs);
}

export interface TrackSample {
  lat: number;
  lon: number;
  ele: number | null;
  /** m/s over ground for the segment this sample falls in. */
  speedMs: number;
  /** Compass heading toward the next point, 0 = North, [0, 360). */
  headingDeg: number;
}

/**
 * Sample a Track at simulated time `tSeconds` (elapsed since track start).
 * Returns null once `tSeconds` is past the end of the track (playback
 * finished). Speed/heading are the sampled segment's real-world values --
 * unaffected by any wall-clock speed_factor, per docs/07 §2.
 */
export function sampleTrack(track: Track, tSeconds: number): TrackSample | null {
  if (tSeconds > track.totalDurationS) {
    return null;
  }
  const t = Math.max(0, tSeconds);
  const points = track.points;

  // Find the segment [i, i+1] whose time range contains t. Linear scan is
  // fine: tracks are small (fixtures have single-digit-to-low-hundreds of
  // points) and this runs once per emitted fix (at most a few Hz).
  let i = 0;
  while (i < points.length - 2 && points[i + 1].cumTimeS <= t) {
    i++;
  }

  const a = points[i];
  const b = points[i + 1];
  const segDurationS = b.cumTimeS - a.cumTimeS;
  const f = segDurationS > 0 ? (t - a.cumTimeS) / segDurationS : 1;
  const segDistanceM = b.cumDistanceM - a.cumDistanceM;
  const speedMs = segDurationS > 0 ? segDistanceM / segDurationS : 0;

  const pos = interpolateLatLon(a, b, f);
  const heading = bearingDeg(a, b);
  const ele = a.ele !== null && b.ele !== null ? a.ele + (b.ele - a.ele) * Math.min(1, Math.max(0, f)) : (a.ele ?? b.ele);

  return { lat: pos.lat, lon: pos.lon, ele, speedMs, headingDeg: heading };
}

/**
 * `detour` mutation: from `atIndex` onward, replace the track with a
 * synthetic leg that turns 90 degrees off the original heading and travels
 * `detourDistanceM` (default 300m) in that new direction -- a deliberate
 * "wrong turn" for later rerouting tests (docs/07 §2). The synthetic leg
 * keeps the same average speed as the segment leaving `atIndex` so the
 * resulting fixes stay speed-plausible.
 */
export function applyDetour(track: Track, atIndex: number, detourDistanceM = 300): Track {
  const points = track.points;
  if (atIndex < 0 || atIndex >= points.length - 1) {
    throw new Error(`detour at_index ${atIndex} is out of range (track has ${points.length} points)`);
  }

  const origin = points[atIndex];
  const originalHeading = bearingDeg(points[atIndex], points[atIndex + 1]);
  const detourHeading = (originalHeading + 90) % 360;
  const originalSegDistanceM = points[atIndex + 1].cumDistanceM - points[atIndex].cumDistanceM;
  const originalSegDurationS = points[atIndex + 1].cumTimeS - points[atIndex].cumTimeS;
  const speedMs = originalSegDurationS > 0 ? originalSegDistanceM / originalSegDurationS : DEFAULT_FALLBACK_SPEED_MS;

  // Step in 50m increments so downstream sampling has intermediate points
  // (matters for tests asserting the path actually bends, not just the
  // final endpoint).
  const stepM = 50;
  const steps = Math.max(1, Math.round(detourDistanceM / stepM));
  const keptPoints = points.slice(0, atIndex + 1);
  const newPoints: TrackPoint[] = [...keptPoints];

  let prev: LatLon = origin;
  for (let s = 1; s <= steps; s++) {
    const distSoFarM = Math.min(detourDistanceM, s * stepM);
    const next = destinationPoint(origin, detourHeading, distSoFarM);
    const segDistanceM = haversineDistanceM(prev, next);
    const segDurationS = segDistanceM / speedMs;
    const prevTrackPoint = newPoints[newPoints.length - 1];
    newPoints.push({
      lat: next.lat,
      lon: next.lon,
      ele: origin.ele,
      cumDistanceM: prevTrackPoint.cumDistanceM + segDistanceM,
      cumTimeS: prevTrackPoint.cumTimeS + segDurationS,
    });
    prev = next;
  }

  const last = newPoints[newPoints.length - 1];
  return { points: newPoints, totalDistanceM: last.cumDistanceM, totalDurationS: last.cumTimeS };
}
