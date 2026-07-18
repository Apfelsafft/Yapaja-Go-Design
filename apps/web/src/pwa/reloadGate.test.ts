import { describe, it, expect } from 'vitest';
import { shouldPromptReload } from './reloadGate.js';
import { DEFAULT_DRIVE_LOCK_KMH } from '../drive/driveLock.js';

const MPS_PER_KMH = 1 / 3.6;

describe('shouldPromptReload (E07-T5: reload prompt only at standstill, never while driving)', () => {
  it('is false when no update is available, regardless of speed', () => {
    expect(shouldPromptReload(0, false)).toBe(false);
    expect(shouldPromptReload(null, false)).toBe(false);
    expect(shouldPromptReload(30 * MPS_PER_KMH, false)).toBe(false);
  });

  it('is false while driving above the threshold, even with an update available', () => {
    const drivingSpeed = (DEFAULT_DRIVE_LOCK_KMH + 5) * MPS_PER_KMH; // 15 km/h > default 10
    expect(shouldPromptReload(drivingSpeed, true)).toBe(false);
  });

  it('is true at standstill (speed 0) with an update available', () => {
    expect(shouldPromptReload(0, true)).toBe(true);
  });

  it('is true when speed is unknown (null/undefined) -- treated as "not moving", same as isSpeedLocked', () => {
    expect(shouldPromptReload(null, true)).toBe(true);
    expect(shouldPromptReload(undefined, true)).toBe(true);
  });

  it('is true exactly at the threshold (strictly-greater-than lock semantics, matches isSpeedLocked)', () => {
    const atThreshold = DEFAULT_DRIVE_LOCK_KMH * MPS_PER_KMH;
    expect(shouldPromptReload(atThreshold, true)).toBe(true);
  });

  it('respects a custom configured threshold', () => {
    const speed = 20 * MPS_PER_KMH; // 20 km/h
    expect(shouldPromptReload(speed, true, 25)).toBe(true); // below custom 25 km/h threshold -> stopped enough
    expect(shouldPromptReload(speed, true, 15)).toBe(false); // above custom 15 km/h threshold -> driving
  });

  it('flips true the moment speed drops back to/under the threshold after driving', () => {
    const driving = 40 * MPS_PER_KMH;
    const stopped = 0;
    expect(shouldPromptReload(driving, true)).toBe(false);
    expect(shouldPromptReload(stopped, true)).toBe(true);
  });
});
