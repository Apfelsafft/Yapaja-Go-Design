/**
 * Unit tests for the pure ETA math (E04-T2): maneuver-time segmentation,
 * remaining-planned-duration interpolation, the calibration EWMA (time
 * series, clamp bounds, standstill freeze), the avg-speed floor, and the
 * `eta` timestamp format.
 */

import { describe, it, expect } from 'vitest';
import type { Maneuver, Route } from '@yapaja/shared';
import {
  buildManeuverAnchors,
  buildTimeSegments,
  computeEtaDuration,
  etaTimestamp,
  initialCalibrationState,
  plannedDurationBetweenM,
  remainingPlannedDurationS,
  updateCalibration,
  CALIBRATION_FREEZE_SPEED_KMH,
  CALIBRATION_MAX_FACTOR,
  CALIBRATION_MIN_FACTOR,
  type CalibrationState,
  type TimeSegment,
} from './eta.js';

function maneuver(over: Partial<Maneuver> & { begin_shape_index: number }): Maneuver {
  return {
    index: 0,
    type: 'continue',
    instruction: '',
    street_names: [],
    distance_m: 0,
    ...over,
  };
}

describe('buildManeuverAnchors', () => {
  it('anchors each maneuver at cumulative[begin_shape_index], sorted ascending', () => {
    const geom = { cumulative: [0, 10, 25, 60, 100] };
    const route: Pick<Route, 'maneuvers'> = {
      maneuvers: [
        maneuver({ begin_shape_index: 3 }),
        maneuver({ begin_shape_index: 0 }),
        maneuver({ begin_shape_index: 1 }),
      ],
    };
    const anchors = buildManeuverAnchors(route, geom);
    expect(anchors.map((a) => a.progressM)).toEqual([0, 10, 60]);
  });

  it('drops maneuvers whose begin_shape_index is out of range', () => {
    const geom = { cumulative: [0, 10, 25] };
    const route: Pick<Route, 'maneuvers'> = {
      maneuvers: [maneuver({ begin_shape_index: 0 }), maneuver({ begin_shape_index: 99 })],
    };
    expect(buildManeuverAnchors(route, geom)).toHaveLength(1);
  });
});

describe('buildTimeSegments', () => {
  it('uses one full-route segment when there are no maneuver anchors', () => {
    const segments = buildTimeSegments([], 1000, 100);
    expect(segments).toEqual([{ startM: 0, endM: 1000, plannedDurationS: 100 }]);
  });

  it('uses each maneuver\'s own duration_s when ALL anchors have it', () => {
    const anchors = [
      { maneuver: maneuver({ begin_shape_index: 0, duration_s: 40 }), progressM: 0 },
      { maneuver: maneuver({ begin_shape_index: 5, duration_s: 60 }), progressM: 400 },
    ];
    const segments = buildTimeSegments(anchors, 1000, 999 /* ignored when per-maneuver present */);
    expect(segments).toEqual([
      { startM: 0, endM: 400, plannedDurationS: 40 },
      { startM: 400, endM: 1000, plannedDurationS: 60 },
    ]);
  });

  it('falls back to a distance-proportional split when ANY anchor lacks duration_s', () => {
    const anchors = [
      { maneuver: maneuver({ begin_shape_index: 0, duration_s: 40 }), progressM: 0 },
      { maneuver: maneuver({ begin_shape_index: 5 /* no duration_s */ }), progressM: 400 },
    ];
    // total 1000 m / 100 s planned -> segment 1 is 400m (40%) -> 40s, segment 2 is 600m (60%) -> 60s.
    const segments = buildTimeSegments(anchors, 1000, 100);
    expect(segments[0].plannedDurationS).toBeCloseTo(40, 6);
    expect(segments[1].plannedDurationS).toBeCloseTo(60, 6);
  });

  it('returns [] for a zero/negative-length route', () => {
    expect(buildTimeSegments([], 0, 100)).toEqual([]);
  });
});

describe('remainingPlannedDurationS', () => {
  const segments: TimeSegment[] = [
    { startM: 0, endM: 400, plannedDurationS: 40 },
    { startM: 400, endM: 1000, plannedDurationS: 60 },
  ];

  it('equals the full planned duration at progress 0', () => {
    expect(remainingPlannedDurationS(segments, 0)).toBeCloseTo(100, 6);
  });

  it('is 0 at/after the route end', () => {
    expect(remainingPlannedDurationS(segments, 1000)).toBe(0);
    expect(remainingPlannedDurationS(segments, 5000)).toBe(0);
  });

  it('interpolates linearly by distance within the straddled segment', () => {
    // progress=200 is halfway through segment 1 (0..400, 40s) -> 20s left of
    // it, plus all of segment 2 (60s) = 80s remaining.
    expect(remainingPlannedDurationS(segments, 200)).toBeCloseTo(80, 6);
    // progress=700 is halfway through segment 2 (400..1000, 60s) -> 30s left.
    expect(remainingPlannedDurationS(segments, 700)).toBeCloseTo(30, 6);
  });

  it('is monotonically non-increasing as progress advances', () => {
    let prev = remainingPlannedDurationS(segments, 0);
    for (let p = 50; p <= 1000; p += 50) {
      const cur = remainingPlannedDurationS(segments, p);
      expect(cur).toBeLessThanOrEqual(prev + 1e-9);
      prev = cur;
    }
  });
});

describe('plannedDurationBetweenM', () => {
  const segments: TimeSegment[] = [
    { startM: 0, endM: 400, plannedDurationS: 40 },
    { startM: 400, endM: 1000, plannedDurationS: 60 },
  ];

  it('matches the difference of remainingPlannedDurationS at the two points', () => {
    expect(plannedDurationBetweenM(segments, 100, 300)).toBeCloseTo(20, 6);
    expect(plannedDurationBetweenM(segments, 200, 700)).toBeCloseTo(50, 6);
  });

  it('is 0 when toM <= fromM', () => {
    expect(plannedDurationBetweenM(segments, 300, 300)).toBe(0);
    expect(plannedDurationBetweenM(segments, 300, 100)).toBe(0);
  });
});

describe('updateCalibration (EWMA)', () => {
  it('starts at factor 1', () => {
    expect(initialCalibrationState()).toEqual({ factor: 1 });
  });

  it('is a no-op when actualDtS or plannedDtS is non-positive', () => {
    const state = initialCalibrationState();
    expect(updateCalibration(state, { actualDtS: 0, plannedDtS: 10, speedKmh: 50 })).toEqual(state);
    expect(updateCalibration(state, { actualDtS: 10, plannedDtS: 0, speedKmh: 50 })).toEqual(state);
    expect(updateCalibration(state, { actualDtS: -1, plannedDtS: 10, speedKmh: 50 })).toEqual(state);
  });

  it('freezes (no-op) below the standstill threshold', () => {
    const state = { factor: 1.2 };
    const belowThreshold = CALIBRATION_FREEZE_SPEED_KMH - 0.1;
    const result = updateCalibration(state, { actualDtS: 60, plannedDtS: 30, speedKmh: belowThreshold });
    expect(result).toEqual(state); // ratio would be 2.0 -- frozen, factor untouched
  });

  it('freezes (no-op) when speed is unknown (null)', () => {
    const state = { factor: 1.2 };
    const result = updateCalibration(state, { actualDtS: 60, plannedDtS: 30, speedKmh: null });
    expect(result).toEqual(state);
  });

  it('moves the factor towards the observed ratio when driving (time series)', () => {
    // Time series: 10 ticks of 1s each, always 20% slower than planned
    // (actual/planned = 1.25), well above the freeze threshold.
    let state: CalibrationState = initialCalibrationState();
    const factors: number[] = [];
    for (let i = 0; i < 10; i++) {
      state = updateCalibration(state, { actualDtS: 1, plannedDtS: 0.8, speedKmh: 40 });
      factors.push(state.factor);
    }
    // Monotonically increasing towards 1.25, never overshooting it.
    for (let i = 1; i < factors.length; i++) {
      expect(factors[i]).toBeGreaterThan(factors[i - 1]);
      expect(factors[i]).toBeLessThanOrEqual(1.25 + 1e-9);
    }
    expect(factors[factors.length - 1]).toBeGreaterThan(1.0);
  });

  it('reproduces the closed-form EWMA value for a single tick', () => {
    const state = initialCalibrationState();
    const actualDtS = 120;
    const plannedDtS = 100; // ratio 1.2
    const result = updateCalibration(state, { actualDtS, plannedDtS, speedKmh: 60 });
    const tau = 600;
    const alpha = 1 - Math.exp(-actualDtS / tau);
    const expected = 1 + alpha * (1.2 - 1);
    expect(result.factor).toBeCloseTo(expected, 9);
  });

  it('clamps the running factor to [0.7, 1.5] even under a sustained extreme ratio', () => {
    let state: CalibrationState = initialCalibrationState();
    // Driving at 1/10th the planned pace for a long time -> ratio 10, way
    // above the clamp; the factor must never exceed CALIBRATION_MAX_FACTOR.
    for (let i = 0; i < 2000; i++) {
      state = updateCalibration(state, { actualDtS: 1, plannedDtS: 0.1, speedKmh: 40 });
      expect(state.factor).toBeLessThanOrEqual(CALIBRATION_MAX_FACTOR);
    }
    // EWMA with tau=600s: after 2000s (~3.3 time constants) it's converged to
    // within ~0.02 of the clamp, not bit-exact -- assert "close" via a bound,
    // not a tight decimal-place match.
    expect(state.factor).toBeGreaterThan(CALIBRATION_MAX_FACTOR - 0.05);
  });

  it('clamps the running factor to [0.7, 1.5] under a sustained extreme low ratio', () => {
    let state: CalibrationState = initialCalibrationState();
    for (let i = 0; i < 2000; i++) {
      state = updateCalibration(state, { actualDtS: 1, plannedDtS: 10, speedKmh: 40 });
      expect(state.factor).toBeGreaterThanOrEqual(CALIBRATION_MIN_FACTOR);
    }
    expect(state.factor).toBeLessThan(CALIBRATION_MIN_FACTOR + 0.05);
  });

  it('a standstill period leaves the factor exactly unchanged (freeze, acceptance scenario 3)', () => {
    let state: CalibrationState = { factor: 1.05 };
    for (let i = 0; i < 180; i++) {
      // 3 minutes stopped: dt advances but speed is ~0.
      state = updateCalibration(state, { actualDtS: 1, plannedDtS: 1, speedKmh: 0 });
    }
    expect(state.factor).toBe(1.05);
  });
});

describe('computeEtaDuration', () => {
  const segments: TimeSegment[] = [{ startM: 0, endM: 1000, plannedDurationS: 100 }];

  it('returns the base planned duration when factor=1 and no avg-speed floor', () => {
    const result = computeEtaDuration({
      segments,
      totalLengthM: 1000,
      progressM: 0,
      calibration: { factor: 1 },
      avgSpeedKmh: null,
    });
    expect(result.basePlannedRemainingS).toBeCloseTo(100, 6);
    expect(result.durationRemainingS).toBe(100);
  });

  it('multiplies by the calibration factor', () => {
    const result = computeEtaDuration({
      segments,
      totalLengthM: 1000,
      progressM: 0,
      calibration: { factor: 1.2 },
      avgSpeedKmh: null,
    });
    expect(result.durationRemainingS).toBe(120);
  });

  it('applies the avg-speed floor only as a LOWER bound (never more optimistic)', () => {
    // 1000m remaining, calibrated says 100s (36 km/h effective) but the
    // profile's avg_speed is only 10 km/h -> floor = 1000 / (10/3.6) = 360s.
    const result = computeEtaDuration({
      segments,
      totalLengthM: 1000,
      progressM: 0,
      calibration: { factor: 1 },
      avgSpeedKmh: 10,
    });
    expect(result.durationRemainingS).toBe(360);
  });

  it('does not let a high avg_speed floor make the ETA MORE optimistic', () => {
    // Floor would be 1000/(200/3.6)=18s, well below the calibrated 100s --
    // max() must keep the (less optimistic) calibrated value.
    const result = computeEtaDuration({
      segments,
      totalLengthM: 1000,
      progressM: 0,
      calibration: { factor: 1 },
      avgSpeedKmh: 200,
    });
    expect(result.durationRemainingS).toBe(100);
  });

  it('never returns a negative duration', () => {
    const result = computeEtaDuration({
      segments,
      totalLengthM: 1000,
      progressM: 1000,
      calibration: { factor: 1 },
      avgSpeedKmh: null,
    });
    expect(result.durationRemainingS).toBe(0);
  });
});

describe('etaTimestamp', () => {
  it('is now + duration, formatted as UTC ISO-8601 with a "Z" offset (W-22)', () => {
    const nowMs = Date.UTC(2026, 0, 1, 12, 0, 0);
    expect(etaTimestamp(nowMs, 90)).toBe('2026-01-01T12:01:30.000Z');
  });

  it('never emits a timestamp before "now" (duration is clamped to >= 0)', () => {
    const nowMs = Date.UTC(2026, 0, 1, 12, 0, 0);
    expect(etaTimestamp(nowMs, -50)).toBe(new Date(nowMs).toISOString());
  });
});
