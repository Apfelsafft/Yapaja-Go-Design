/**
 * Maneuver-type mapping table tests. The table is safety-relevant (turn icons);
 * every mapped Valhalla enum value is pinned and unknown values pass through.
 */

import { describe, it, expect } from 'vitest';
import { mapManeuverType, VALHALLA_MANEUVER_TYPE } from './maneuverMapping.js';

describe('mapManeuverType', () => {
  const cases: Array<[number, string]> = [
    [0, 'continue'], // kNone
    [1, 'straight'], // kStart
    [2, 'turn_right'], // kStartRight
    [3, 'turn_left'], // kStartLeft
    [4, 'straight'], // kDestination
    [5, 'turn_right'], // kDestinationRight
    [6, 'turn_left'], // kDestinationLeft
    [7, 'continue'], // kBecomes
    [8, 'continue'], // kContinue
    [9, 'turn_right'], // kSlightRight
    [10, 'turn_right'], // kRight
    [11, 'turn_right'], // kSharpRight
    [12, 'uturn_right'], // kUturnRight (distinct)
    [13, 'uturn_left'], // kUturnLeft (distinct)
    [14, 'turn_left'], // kSharpLeft
    [15, 'turn_left'], // kLeft
    [16, 'turn_left'], // kSlightLeft
    [17, 'straight'], // kRampStraight
    [18, 'turn_right'], // kRampRight
    [19, 'turn_left'], // kRampLeft
    [20, 'turn_right'], // kExitRight
    [21, 'turn_left'], // kExitLeft
    [22, 'straight'], // kStayStraight
    [23, 'turn_right'], // kStayRight
    [24, 'turn_left'], // kStayLeft
    [25, 'continue'], // kMerge
    [26, 'roundabout_enter'], // kRoundaboutEnter
    [27, 'roundabout_exit'], // kRoundaboutExit
    [28, 'continue'], // kFerryEnter
    [29, 'continue'], // kFerryExit
  ];

  it.each(cases)('maps Valhalla type %i -> %s', (input, expected) => {
    expect(mapManeuverType(input)).toBe(expected);
  });

  it('never collapses a U-turn into a plain turn', () => {
    expect(mapManeuverType(12)).toBe('uturn_right');
    expect(mapManeuverType(13)).toBe('uturn_left');
    expect(mapManeuverType(12)).not.toBe('turn_right');
    expect(mapManeuverType(13)).not.toBe('turn_left');
  });

  it('passes an unknown/future type through as its decimal string', () => {
    expect(mapManeuverType(999)).toBe('999');
    expect(mapManeuverType(37)).toBe('37');
  });

  it('every table value is a non-empty string', () => {
    for (const value of Object.values(VALHALLA_MANEUVER_TYPE)) {
      expect(typeof value).toBe('string');
      expect((value as string).length).toBeGreaterThan(0);
    }
  });
});
