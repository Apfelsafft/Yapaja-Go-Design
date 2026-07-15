import { describe, it, expect } from 'vitest';
import { isSearchSpeedLocked, SEARCH_SPEED_LOCK_KMH } from './speedLock.js';

describe('isSearchSpeedLocked', () => {
  it('is unlocked when speed is null (no fix / unknown)', () => {
    expect(isSearchSpeedLocked(null)).toBe(false);
  });

  it('is unlocked when speed is undefined', () => {
    expect(isSearchSpeedLocked(undefined)).toBe(false);
  });

  it('is unlocked at 0 m/s', () => {
    expect(isSearchSpeedLocked(0)).toBe(false);
  });

  it(`is unlocked exactly at the ${SEARCH_SPEED_LOCK_KMH} km/h threshold`, () => {
    const speedMps = SEARCH_SPEED_LOCK_KMH / 3.6;
    expect(isSearchSpeedLocked(speedMps)).toBe(false);
  });

  it(`is locked just above the ${SEARCH_SPEED_LOCK_KMH} km/h threshold`, () => {
    const speedMps = SEARCH_SPEED_LOCK_KMH / 3.6 + 0.01;
    expect(isSearchSpeedLocked(speedMps)).toBe(true);
  });

  it('is locked at a typical driving speed (50 km/h)', () => {
    expect(isSearchSpeedLocked(50 / 3.6)).toBe(true);
  });

  it('is unlocked at walking speed (~5 km/h)', () => {
    expect(isSearchSpeedLocked(5 / 3.6)).toBe(false);
  });
});
