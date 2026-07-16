/**
 * Deviation-detection & reroute-policy units (E04-T4, 🔴 safety-critical).
 *
 * The detection tests drive the FULL chain — real matcher (`matchPosition`) +
 * on-route rule (`evaluateOnRoute`) + `DeviationDetector` — against fixed
 * time-series fixtures, because that whole chain is the safety claim:
 *  - 15 m GPS noise NEVER confirms (stays inside the 30 m corridor);
 *  - a genuine move onto a PARALLEL road ~40–60 m alongside DOES confirm.
 */

import { describe, it, expect } from 'vitest';
import {
  DeviationDetector,
  RerouteGuard,
  CONFIRM_MIN_FIXES,
  REROUTE_DEBOUNCE_MS,
} from './reroute.js';
import { buildRouteGeometryFromPoints, matchPosition, evaluateOnRoute } from './mapMatching.js';
import type { LatLon } from './geo.js';

// A ~2 km straight north-bound route at 47°N, vertices ~111 m apart.
const BASE_LAT = 47.0;
const BASE_LON = 9.5;
function northRoute(): LatLon[] {
  const pts: LatLon[] = [];
  for (let i = 0; i <= 18; i++) pts.push({ lat: BASE_LAT + i * 0.001, lon: BASE_LON });
  return pts;
}

/** Metres of longitude at 47°N per degree, for building lateral offsets. */
const M_PER_DEG_LON = 111_320 * Math.cos((BASE_LAT * Math.PI) / 180);

/**
 * Feed a lateral-offset track (metres east of the route centre-line) through
 * matcher + on-route rule + detector and return whether/when it confirmed.
 * Vehicle drives north at ~15 m/s (~0.000135°/fix), one fix per second.
 */
function runTrack(
  offsetsM: number[],
  opts: { headingDeg?: number | null; speedMs?: number | null; startMs?: number } = {},
): { confirmedAt: number | null; onRouteFlags: boolean[] } {
  const geom = buildRouteGeometryFromPoints(northRoute());
  const detector = new DeviationDetector();
  const headingDeg = opts.headingDeg === undefined ? 0 : opts.headingDeg; // north
  const speedMs = opts.speedMs === undefined ? 15 : opts.speedMs;
  const startMs = opts.startMs ?? 1_000_000;

  let prevProgress: number | null = null;
  let confirmedAt: number | null = null;
  const onRouteFlags: boolean[] = [];

  for (let i = 0; i < offsetsM.length; i++) {
    const lat = BASE_LAT + 0.0004 + i * 0.00027; // advance north each fix
    const lon = BASE_LON + offsetsM[i] / M_PER_DEG_LON;
    const point = { lat, lon };
    const m = matchPosition(geom, point, prevProgress, 500);
    prevProgress = Math.max(m.progressM, prevProgress ?? m.progressM);
    const onRoute = evaluateOnRoute({
      crossTrackM: m.crossTrackM,
      matchedHeadingDeg: m.matchedHeadingDeg,
      headingDeg,
      speedMs,
    });
    onRouteFlags.push(onRoute);
    const tsMs = startMs + i * 1000;
    const upd = detector.update({ onRoute, tsMs });
    if (upd.justConfirmed && confirmedAt === null) confirmedAt = tsMs;
  }
  return { confirmedAt, onRouteFlags };
}

describe('DeviationDetector (5 s / 5 fixes confirmation)', () => {
  it('confirms only after BOTH ≥5 fixes AND ≥5 s of sustained deviation', () => {
    const d = new DeviationDetector();
    // Off-route fixes at 1 Hz starting t=0.
    const results: boolean[] = [];
    for (let i = 0; i <= 6; i++) {
      results.push(d.update({ onRoute: false, tsMs: i * 1000 }).justConfirmed);
    }
    // 5 fixes span only 4 s (< 5 s) -> not yet; the fix at t=5 s (6th) confirms.
    expect(results.slice(0, 6)).toEqual([false, false, false, false, false, true]);
    // Stays confirmed (non-latching) but justConfirmed fires only once.
    expect(results[6]).toBe(false);
    expect(d.isConfirmed).toBe(true);
  });

  it('a 2-fix blip does NOT confirm and resets on return to route', () => {
    const d = new DeviationDetector();
    expect(d.update({ onRoute: false, tsMs: 0 }).phase).toBe('pending');
    expect(d.update({ onRoute: false, tsMs: 1000 }).phase).toBe('pending');
    const back = d.update({ onRoute: true, tsMs: 2000 });
    expect(back.phase).toBe('on_route');
    expect(d.isConfirmed).toBe(false);
    // A fresh long streak after the blip still needs the full window.
    let confirmed = false;
    for (let i = 0; i <= 6; i++) {
      confirmed = confirmed || d.update({ onRoute: false, tsMs: 3000 + i * 1000 }).justConfirmed;
    }
    expect(confirmed).toBe(true);
  });

  it('needs at least CONFIRM_MIN_FIXES fixes even if 5 s elapse in fewer', () => {
    const d = new DeviationDetector();
    // Two off-route fixes 6 s apart: time passes but only 2 fixes -> no confirm.
    expect(d.update({ onRoute: false, tsMs: 0 }).phase).toBe('pending');
    expect(d.update({ onRoute: false, tsMs: 6000 }).justConfirmed).toBe(false);
    expect(d.isConfirmed).toBe(false);
    expect(CONFIRM_MIN_FIXES).toBe(5);
  });
});

describe('detection chain (matcher + on-route rule + detector)', () => {
  it('15 m GPS noise NEVER confirms a deviation', () => {
    // 40 fixes wobbling ±15 m around the centre-line (deterministic sawtooth).
    const offsets = Array.from({ length: 40 }, (_, i) => (i % 2 === 0 ? 15 : -15));
    const { confirmedAt, onRouteFlags } = runTrack(offsets);
    expect(confirmedAt).toBeNull();
    // Every noisy fix stays inside the 30 m corridor -> on-route.
    expect(onRouteFlags.every((f) => f)).toBe(true);
  });

  it('detects a move onto a PARALLEL road ~40–60 m alongside the route', () => {
    // Ramp out to ~50 m east then hold — a parallel road, not noise. The ±500 m
    // matcher keeps matching the ORIGINAL route, so cross-track grows past 30 m.
    const offsets = [0, 10, 25, 45, 50, 52, 55, 55, 55, 55, 55, 55];
    const { confirmedAt, onRouteFlags } = runTrack(offsets);
    expect(confirmedAt).not.toBeNull();
    // The sustained ~55 m offset reads as off-route.
    expect(onRouteFlags.slice(4).every((f) => !f)).toBe(true);
  });
});

describe('RerouteGuard (debounce + W-05 loop guard)', () => {
  const spot = { lat: 47.01, lon: 9.5 };

  it('debounces to at most one attempt per 10 s', () => {
    const g = new RerouteGuard();
    expect(g.canAttempt(0)).toBe(true);
    g.noteAttempt(0);
    expect(g.canAttempt(5000)).toBe(false);
    expect(g.canAttempt(REROUTE_DEBOUNCE_MS)).toBe(true);
  });

  it('flags the 3rd clustered reroute (within 200 m / 5 min) as a loop', () => {
    const g = new RerouteGuard();
    // Two successful reroutes near the same spot.
    expect(g.checkLoop(0, spot)).toBe(false);
    g.noteAttempt(0);
    g.noteSuccess(0, spot);
    const near = { lat: spot.lat + 0.0005, lon: spot.lon }; // ~55 m away
    expect(g.checkLoop(10_000, near)).toBe(false);
    g.noteAttempt(10_000);
    g.noteSuccess(10_000, near);
    // 3rd clustered deviation -> loop.
    expect(g.checkLoop(20_000, spot)).toBe(true);
    // …and the spot is now blocked for future auto-reroutes.
    expect(g.isBlocked(spot)).toBe(true);
  });

  it('does NOT flag a loop when reroutes are far apart in space', () => {
    const g = new RerouteGuard();
    g.noteSuccess(0, spot);
    g.noteSuccess(10_000, spot);
    const faraway = { lat: 47.5, lon: 9.5 }; // ~55 km north
    expect(g.checkLoop(20_000, faraway)).toBe(false);
  });

  it('does NOT flag a loop when reroutes fall outside the 5 min window', () => {
    const g = new RerouteGuard();
    g.noteSuccess(0, spot);
    g.noteSuccess(1000, spot);
    // 6 min later the earlier two have aged out of the window.
    expect(g.checkLoop(6 * 60_000, spot)).toBe(false);
  });
});
