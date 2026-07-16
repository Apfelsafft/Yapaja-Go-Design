/**
 * Maneuver logic / announcement engine / speed-limit unit tests (E04-T3).
 * Pflicht-Tests: threshold speed-scaling + double-fire protection, say-text
 * snapshots (every ManeuverType, de+en), speed-segment lookup (boundary
 * crossing + empty/gap -> null).
 */

import { describe, it, expect } from 'vitest';
import type { Maneuver, SpeedSegment } from '@yapaja/shared';
import {
  BASE_ANNOUNCE_THRESHOLDS_M,
  IMMEDIATE_THRESHOLD_INDEX,
  THRESHOLD_SPEED_SCALE_S,
  scaledThresholdM,
  initialAnnouncementState,
  tickAnnouncement,
  buildSayText,
  roundToStep,
  findUpcomingManeuver,
  buildSpeedSegmentAnchors,
  findActiveSpeedLimitKmh,
  type AnnouncementState,
} from './instructions.js';
import type { ManeuverAnchor } from './eta.js';
import type { RouteGeometry } from './mapMatching.js';

function maneuver(overrides: Partial<Maneuver> = {}): Maneuver {
  return {
    index: 0,
    type: 'turn_left',
    instruction: 'Links abbiegen auf Bundesstraße 27',
    street_names: ['Bundesstraße 27'],
    distance_m: 500,
    begin_shape_index: 0,
    ...overrides,
  };
}

// --- Threshold speed-scaling -------------------------------------------------

describe('scaledThresholdM', () => {
  it('at rest (speed 0/null), the scaled threshold equals the base', () => {
    expect(scaledThresholdM(200, 0)).toBe(200);
    expect(scaledThresholdM(200, null)).toBe(200);
    expect(scaledThresholdM(2000, 0)).toBe(2000);
  });

  it('scales up to 12s * speed when that exceeds the base (highway speed)', () => {
    const speedMs = 36; // ~130 km/h
    expect(scaledThresholdM(200, speedMs)).toBe(THRESHOLD_SPEED_SCALE_S * speedMs); // 432 > 200
    expect(scaledThresholdM(0, speedMs)).toBe(THRESHOLD_SPEED_SCALE_S * speedMs); // "Jetzt" scales too
  });

  it('never goes BELOW the base, even at negative/garbage speed', () => {
    expect(scaledThresholdM(500, -5)).toBe(500);
  });

  it('BASE_ANNOUNCE_THRESHOLDS_M matches docs/06 §5: 2000, 500, 200, "Jetzt" (0)', () => {
    expect(BASE_ANNOUNCE_THRESHOLDS_M).toEqual([2000, 500, 200, 0]);
    expect(IMMEDIATE_THRESHOLD_INDEX).toBe(3);
  });
});

// --- Announcement engine: firing + double-fire protection -------------------

describe('tickAnnouncement', () => {
  const m1 = maneuver({ index: 1 });
  const m2 = maneuver({ index: 2, type: 'turn_right', street_names: ['Seestraße'] });

  it('fires the first (2000 m) threshold once distance drops to/below it', () => {
    let state = initialAnnouncementState();
    const r1 = tickAnnouncement(state, {
      maneuver: m1,
      maneuverKey: 'r:1',
      distanceToManeuverM: 2500,
      speedMs: 0,
    });
    expect(r1.fire).toBeNull(); // still above 2000 m

    state = r1.state;
    const r2 = tickAnnouncement(state, {
      maneuver: m1,
      maneuverKey: 'r:1',
      distanceToManeuverM: 1900,
      speedMs: 0,
    });
    expect(r2.fire?.thresholdIndex).toBe(0);
    expect(r2.fire?.immediate).toBe(false);
  });

  it('fires each subsequent threshold exactly once as distance decreases', () => {
    let state: AnnouncementState = initialAnnouncementState();
    const distances = [2500, 1900, 450, 150, 0];
    const firedIndices: number[] = [];
    for (const d of distances) {
      const r = tickAnnouncement(state, { maneuver: m1, maneuverKey: 'r:1', distanceToManeuverM: d, speedMs: 0 });
      state = r.state;
      if (r.fire) firedIndices.push(r.fire.thresholdIndex);
    }
    expect(firedIndices).toEqual([0, 1, 2, 3]);
  });

  it('double-fire protection: re-crossing the SAME threshold (GPS jitter) never re-fires it', () => {
    let state = initialAnnouncementState();
    const first = tickAnnouncement(state, {
      maneuver: m1,
      maneuverKey: 'r:1',
      distanceToManeuverM: 450,
      speedMs: 0,
    });
    expect(first.fire?.thresholdIndex).toBe(1); // crossed 2000 AND 500 in one tick -> nearest (500) fires
    state = first.state;

    // Jitter: distance briefly increases back above 500 m, then drops below it again.
    const jitterUp = tickAnnouncement(state, {
      maneuver: m1,
      maneuverKey: 'r:1',
      distanceToManeuverM: 520,
      speedMs: 0,
    });
    expect(jitterUp.fire).toBeNull();
    state = jitterUp.state;

    const jitterDown = tickAnnouncement(state, {
      maneuver: m1,
      maneuverKey: 'r:1',
      distanceToManeuverM: 480,
      speedMs: 0,
    });
    expect(jitterDown.fire).toBeNull(); // threshold 1 already fired, must not re-fire
  });

  it('W-23: a tick that jumps past several thresholds at once fires only the NEAREST one (no backlog)', () => {
    const state = initialAnnouncementState();
    const r = tickAnnouncement(state, {
      maneuver: m1,
      maneuverKey: 'r:1',
      distanceToManeuverM: 0, // past 2000, 500, 200 AND "Jetzt" in one tick
      speedMs: 0,
    });
    expect(r.fire?.thresholdIndex).toBe(IMMEDIATE_THRESHOLD_INDEX);
    expect(r.state.firedUpToIndex).toBe(IMMEDIATE_THRESHOLD_INDEX);
  });

  it('passing the maneuver (it stops being "upcoming") means it is never announced again', () => {
    let state = initialAnnouncementState();
    const firedFor1: number[] = [];
    for (const d of [1900, 450, 150, 0]) {
      const r = tickAnnouncement(state, { maneuver: m1, maneuverKey: 'r:1', distanceToManeuverM: d, speedMs: 0 });
      state = r.state;
      if (r.fire) firedFor1.push(r.fire.thresholdIndex);
    }
    expect(firedFor1).toEqual([0, 1, 2, 3]);

    // Passed maneuver 1; maneuver 2 is now upcoming -> fresh tracking, no
    // announcement fires again for maneuver 1 (it's simply never passed in again).
    const r = tickAnnouncement(state, {
      maneuver: m2,
      maneuverKey: 'r:2',
      distanceToManeuverM: 1900,
      speedMs: 0,
    });
    expect(r.state.maneuverKey).toBe('r:2');
    expect(r.state.firedUpToIndex).toBe(0);
    expect(r.fire?.maneuver.index).toBe(2);
  });

  it('no active maneuver (null) resets tracking and never fires', () => {
    const primed: AnnouncementState = { maneuverKey: 'r:1', firedUpToIndex: 2 };
    const r = tickAnnouncement(primed, {
      maneuver: null,
      maneuverKey: null,
      distanceToManeuverM: null,
      speedMs: 0,
    });
    expect(r.fire).toBeNull();
    expect(r.state).toEqual(initialAnnouncementState());
  });
});

// --- findUpcomingManeuver -----------------------------------------------------

describe('findUpcomingManeuver', () => {
  const anchors: ManeuverAnchor[] = [
    { maneuver: maneuver({ index: 0 }), progressM: 100 },
    { maneuver: maneuver({ index: 1 }), progressM: 300 },
  ];

  it('returns the first anchor still ahead of progress', () => {
    expect(findUpcomingManeuver(anchors, 0)?.maneuver.index).toBe(0);
    expect(findUpcomingManeuver(anchors, 150)?.maneuver.index).toBe(1);
  });

  it('returns null once progress passes the last anchor', () => {
    expect(findUpcomingManeuver(anchors, 300)).toBeNull();
    expect(findUpcomingManeuver(anchors, 1000)).toBeNull();
  });
});

// --- say-text: every ManeuverType the pipeline can produce, de + en ---------

describe('buildSayText', () => {
  const KNOWN_TYPES = [
    'turn_left',
    'turn_right',
    'uturn_left',
    'uturn_right',
    'roundabout_enter',
    'roundabout_exit',
    'straight',
    'continue',
  ] as const;

  it('matches the docs/06 §5 canonical example exactly', () => {
    const say = buildSayText(
      { maneuver: maneuver({ type: 'turn_left', street_names: ['Bundesstraße 27'] }), distanceM: 287 },
      'de',
    );
    expect(say).toBe('In 300 Metern links abbiegen auf die Bundesstraße 27');
  });

  it.each(KNOWN_TYPES)('snapshot: type "%s" (de)', (type) => {
    const say = buildSayText(
      { maneuver: maneuver({ type, street_names: ['Teststraße'] }), distanceM: 340 },
      'de',
    );
    expect(say).toMatchSnapshot();
  });

  it.each(KNOWN_TYPES)('snapshot: type "%s" (en)', (type) => {
    const say = buildSayText(
      { maneuver: maneuver({ type, street_names: ['Teststraße'] }), distanceM: 340 },
      'en',
    );
    expect(say).toMatchSnapshot();
  });

  it('snapshot: unmapped/unknown type falls back gracefully instead of throwing (de)', () => {
    const say = buildSayText(
      { maneuver: maneuver({ type: '42', street_names: ['Teststraße'] }), distanceM: 340 },
      'de',
    );
    expect(say).toMatchSnapshot();
  });

  it('snapshot: unmapped/unknown type falls back gracefully instead of throwing (en)', () => {
    const say = buildSayText(
      { maneuver: maneuver({ type: '42', street_names: ['Teststraße'] }), distanceM: 340 },
      'en',
    );
    expect(say).toMatchSnapshot();
  });

  it('the immediate ("Jetzt"/"Now") flag skips the distance phrase entirely', () => {
    const de = buildSayText(
      { maneuver: maneuver({ type: 'turn_right', street_names: ['Marktstraße'] }), distanceM: 5, immediate: true },
      'de',
    );
    expect(de).toBe('Jetzt rechts abbiegen auf die Marktstraße');
    const en = buildSayText(
      { maneuver: maneuver({ type: 'turn_right', street_names: ['Marktstraße'] }), distanceM: 5, immediate: true },
      'en',
    );
    expect(en).toBe('Now turn right onto Marktstraße');
  });

  it('no street_names -> omits the street clause instead of producing "auf die undefined"', () => {
    const say = buildSayText({ maneuver: maneuver({ type: 'turn_left', street_names: [] }), distanceM: 300 }, 'de');
    expect(say).toBe('In 300 Metern links abbiegen');
    expect(say).not.toContain('undefined');
  });

  it('rounds to km phrasing above 1000 m', () => {
    const say = buildSayText({ maneuver: maneuver({ street_names: ['B27'] }), distanceM: 2000 }, 'de');
    expect(say).toBe('In 2 Kilometern links abbiegen auf die B27');
  });
});

describe('roundToStep', () => {
  it('rounds to 50 m steps', () => {
    expect(roundToStep(287)).toBe(300);
    expect(roundToStep(263)).toBe(250);
    expect(roundToStep(24)).toBe(0); // below the halfway point -> rounds down
    expect(roundToStep(26)).toBe(50); // above the halfway point -> rounds up
  });

  it('never negative, even for garbage input', () => {
    expect(roundToStep(-100)).toBe(0);
    expect(roundToStep(NaN)).toBe(0);
  });
});

// --- Speed-limit segment lookup ----------------------------------------------

function flatGeom(cumulative: number[]): Pick<RouteGeometry, 'cumulative'> {
  return { cumulative };
}

describe('speed-limit segment lookup', () => {
  // 5 points, 100 m apart -> cumulative [0, 100, 200, 300, 400].
  const geom = flatGeom([0, 100, 200, 300, 400]);

  it('empty speed_limits -> anchors empty -> lookup is always null (never 0)', () => {
    const anchors = buildSpeedSegmentAnchors([], geom);
    expect(anchors).toEqual([]);
    expect(findActiveSpeedLimitKmh(anchors, 150)).toBeNull();
  });

  it('progress inside a segment resolves to that segment\'s kmh', () => {
    const limits: SpeedSegment[] = [
      { begin_shape_index: 0, end_shape_index: 2, kmh: 50 },
      { begin_shape_index: 2, end_shape_index: 4, kmh: 100 },
    ];
    const anchors = buildSpeedSegmentAnchors(limits, geom);
    expect(findActiveSpeedLimitKmh(anchors, 50)).toBe(50);
    expect(findActiveSpeedLimitKmh(anchors, 250)).toBe(100);
  });

  it('crossing a segment boundary changes the returned value', () => {
    const limits: SpeedSegment[] = [
      { begin_shape_index: 0, end_shape_index: 2, kmh: 50 },
      { begin_shape_index: 2, end_shape_index: 4, kmh: 100 },
    ];
    const anchors = buildSpeedSegmentAnchors(limits, geom);
    // Just before vs. just after the 200 m boundary.
    expect(findActiveSpeedLimitKmh(anchors, 199)).toBe(50);
    expect(findActiveSpeedLimitKmh(anchors, 201)).toBe(100);
  });

  it('a gap between segments yields null (never fabricates a value)', () => {
    const limits: SpeedSegment[] = [
      { begin_shape_index: 0, end_shape_index: 1, kmh: 50 }, // covers [0,100)
      { begin_shape_index: 3, end_shape_index: 4, kmh: 80 }, // covers [300,400)
    ];
    const anchors = buildSpeedSegmentAnchors(limits, geom);
    expect(findActiveSpeedLimitKmh(anchors, 50)).toBe(50);
    expect(findActiveSpeedLimitKmh(anchors, 200)).toBeNull(); // in the gap
    expect(findActiveSpeedLimitKmh(anchors, 350)).toBe(80);
  });

  it('a segment whose own kmh is null ("unbekannt") is passed through as null, not skipped', () => {
    const limits: SpeedSegment[] = [{ begin_shape_index: 0, end_shape_index: 2, kmh: null }];
    const anchors = buildSpeedSegmentAnchors(limits, geom);
    expect(findActiveSpeedLimitKmh(anchors, 50)).toBeNull();
  });

  it('out-of-range shape indices are dropped defensively (never throw)', () => {
    const limits: SpeedSegment[] = [{ begin_shape_index: 0, end_shape_index: 99, kmh: 50 }];
    expect(() => buildSpeedSegmentAnchors(limits, geom)).not.toThrow();
    expect(buildSpeedSegmentAnchors(limits, geom)).toEqual([]);
  });
});
