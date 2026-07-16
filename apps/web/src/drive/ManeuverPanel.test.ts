/**
 * Unit tests for ManeuverPanel's pure helpers (E04-T3): the "drive is
 * active" status gate and the "< 300 m -> show following maneuver" rule
 * (docs/06 §5).
 */

import { describe, it, expect } from 'vitest';
import type { Maneuver } from '@yapaja/shared';
import { isDriveActive, findFollowingManeuver } from './ManeuverPanel.js';

function maneuver(overrides: Partial<Maneuver> = {}): Maneuver {
  return {
    index: 0,
    type: 'turn_left',
    instruction: 'Links abbiegen',
    street_names: ['Erste Straße'],
    distance_m: 500,
    begin_shape_index: 0,
    ...overrides,
  };
}

describe('isDriveActive', () => {
  it('true for navigating/off_route/paused', () => {
    expect(isDriveActive('navigating')).toBe(true);
    expect(isDriveActive('off_route')).toBe(true);
    expect(isDriveActive('paused')).toBe(true);
  });

  it('false for idle/routing/arrived/null/undefined', () => {
    expect(isDriveActive('idle')).toBe(false);
    expect(isDriveActive('routing')).toBe(false);
    expect(isDriveActive('arrived')).toBe(false);
    expect(isDriveActive(null)).toBe(false);
    expect(isDriveActive(undefined)).toBe(false);
  });
});

describe('findFollowingManeuver', () => {
  const route: Maneuver[] = [
    maneuver({ index: 0, type: 'straight', street_names: ['Erste Straße'], distance_m: 250 }),
    maneuver({ index: 1, type: 'turn_right', street_names: ['Zweite Straße'], distance_m: 900 }),
    maneuver({ index: 2, type: 'turn_left', street_names: ['Dritte Straße'], distance_m: 400 }),
  ];

  it('returns the next maneuver when the gap is < 300 m', () => {
    const following = findFollowingManeuver(route[0], route);
    expect(following).toEqual({ type: 'turn_right', street: 'Zweite Straße' });
  });

  it('returns null when the gap is >= 300 m (dense-turn threshold, docs/06 §5)', () => {
    expect(findFollowingManeuver(route[1], route)).toBeNull();
  });

  it('returns null at exactly the 300 m boundary (not "< 300")', () => {
    const exact = maneuver({ index: 5, distance_m: 300 });
    expect(findFollowingManeuver(exact, [exact, maneuver({ index: 6 })])).toBeNull();
  });

  it('returns null when there is no next maneuver in the route (last one)', () => {
    expect(findFollowingManeuver(route[2], route)).toBeNull();
  });

  it('returns null when the route maneuver list is unavailable', () => {
    expect(findFollowingManeuver(route[0], undefined)).toBeNull();
  });

  it('following maneuver with no street name -> street is null, not "undefined"', () => {
    const noStreet: Maneuver[] = [
      maneuver({ index: 0, distance_m: 100 }),
      maneuver({ index: 1, street_names: [] }),
    ];
    expect(findFollowingManeuver(noStreet[0], noStreet)).toEqual({ type: 'turn_left', street: null });
  });
});
