/**
 * Pure mutation helpers (E02-T4). `detour` lives in track.ts (it rewrites
 * the track geometry itself, at play() time); the other three act per-tick
 * on an already-sampled position and are applied by the simulator's tick
 * loop in index.ts, which owns the one-shot ("jumpApplied") state.
 */

import { destinationPoint, toRadians, type LatLon } from './geo.js';
import { gaussianSample, type Rng } from './rng.js';

const METERS_PER_DEGREE_LAT = 111320;

export interface OutageMutation {
  /** Simulated seconds since track start when the outage begins. */
  at_s: number;
  duration_s: number;
}

export interface JumpMutation {
  /** Simulated seconds since track start when the jump fires (once). */
  at_s: number;
  offset_m: number;
}

export interface DetourMutation {
  /** Track waypoint index (pre-mutation) at which the detour begins. */
  at_index: number;
}

export interface SimulatorMutations {
  noise_m?: number;
  seed?: number;
  outage?: OutageMutation;
  jump?: JumpMutation;
  detour?: DetourMutation;
}

/** Whether simulated time `tSeconds` falls inside the outage window (fixes must not be pushed then). */
export function isWithinOutage(tSeconds: number, outage: OutageMutation | undefined): boolean {
  if (!outage) return false;
  return tSeconds >= outage.at_s && tSeconds < outage.at_s + outage.duration_s;
}

/**
 * Gaussian-noise a position by `metersStdDev` meters (seed-based
 * deterministic via `rng`), independently in the local north and east
 * directions, then convert back to lat/lon degrees.
 */
export function applyGaussianNoise(pos: LatLon, rng: Rng, metersStdDev: number): LatLon {
  const northOffsetM = gaussianSample(rng) * metersStdDev;
  const eastOffsetM = gaussianSample(rng) * metersStdDev;
  const metersPerDegreeLon = METERS_PER_DEGREE_LAT * Math.cos(toRadians(pos.lat));
  const dLat = northOffsetM / METERS_PER_DEGREE_LAT;
  const dLon = metersPerDegreeLon !== 0 ? eastOffsetM / metersPerDegreeLon : 0;
  return { lat: pos.lat + dLat, lon: pos.lon + dLon };
}

/**
 * One-shot position jump: displaces `pos` by `offsetM` meters perpendicular
 * to the current heading (so it reads as a discontinuity, not "further
 * along the same line"). Direction is fully deterministic given
 * heading+offset -- no RNG involved.
 */
export function applyJumpOffset(pos: LatLon, headingDeg: number, offsetM: number): LatLon {
  const jumpBearing = (headingDeg + 90) % 360;
  return destinationPoint(pos, jumpBearing, offsetM);
}
