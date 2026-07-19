import { describe, it, expect } from 'vitest';
import { shouldRecommendPhotonOff, recommendPhotonOff, LOW_DISK_THRESHOLD_BYTES } from './resourceRecommendation.js';

describe('shouldRecommendPhotonOff (W-12/W-18 threshold logic)', () => {
  it('recommends Photon off well below the threshold', () => {
    expect(shouldRecommendPhotonOff(1_000_000_000)).toBe(true); // 1 GB
  });

  it('does not recommend well above the threshold', () => {
    expect(shouldRecommendPhotonOff(10_000_000_000)).toBe(false); // 10 GB
  });

  it('is exact at the boundary: exactly 3 GB does NOT trigger, one byte less DOES', () => {
    expect(shouldRecommendPhotonOff(LOW_DISK_THRESHOLD_BYTES)).toBe(false);
    expect(shouldRecommendPhotonOff(LOW_DISK_THRESHOLD_BYTES - 1)).toBe(true);
  });

  it('handles zero free bytes', () => {
    expect(shouldRecommendPhotonOff(0)).toBe(true);
  });
});

describe('recommendPhotonOff (SystemResources wrapper)', () => {
  it('delegates to disk_free_bytes only', () => {
    expect(recommendPhotonOff({ disk_free_bytes: 1_000_000_000 })).toBe(true);
    expect(recommendPhotonOff({ disk_free_bytes: 10_000_000_000 })).toBe(false);
  });
});
