import { describe, it, expect } from 'vitest';
import { formatDistance } from './utils';

describe('formatDistance', () => {
  it('should format distances less than 1km in meters', () => {
    expect(formatDistance(100)).toBe('100 m');
    expect(formatDistance(850)).toBe('850 m');
    expect(formatDistance(999)).toBe('999 m');
  });

  it('should format distances 1km and above in kilometers', () => {
    expect(formatDistance(1000)).toBe('1,0 km');
    expect(formatDistance(1200)).toBe('1,2 km');
    expect(formatDistance(5500)).toBe('5,5 km');
  });

  it('should handle edge cases', () => {
    expect(formatDistance(0)).toBe('0 m');
    expect(formatDistance(1)).toBe('1 m');
  });
});
