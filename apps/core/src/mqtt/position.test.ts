/**
 * Unit tests for the `yapaja/position` extrapolated-fix filter (E08-T1,
 * mandatory unit test: "extrapolated-Filter", docs/03 §4 / E02-T5 stub).
 */
import { describe, it, expect } from 'vitest';
import type { Position } from '@yapaja/shared';
import type { ExtrapolatedPositionPayload } from '../bus/index.js';
import { isRealPosition } from './position.js';

function makePosition(overrides: Partial<Position> = {}): Position {
  return {
    lat: 47.0,
    lon: 9.5,
    alt: 400,
    speed: 10,
    heading: 90,
    accuracy: 5,
    source: 'simulator',
    fix: '3d',
    ts: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

describe('isRealPosition', () => {
  it('accepts a genuine (non-extrapolated) Position', () => {
    expect(isRealPosition(makePosition())).toBe(true);
  });

  it('rejects an extrapolated:true fix -- never published as yapaja/position', () => {
    const extrapolated: ExtrapolatedPositionPayload = { ...makePosition(), extrapolated: true };
    expect(isRealPosition(extrapolated)).toBe(false);
  });

  it('a Position that merely HAS an "extrapolated" key set to something other than true is still accepted', () => {
    // Defensive: only the literal `extrapolated: true` discriminant filters a
    // fix out -- any other shape passes through untouched.
    const withFalseFlag = { ...makePosition(), extrapolated: false } as unknown as Position;
    expect(isRealPosition(withFalseFlag)).toBe(true);
  });
});
