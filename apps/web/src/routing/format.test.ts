import { describe, it, expect } from 'vitest';
import { formatDistance, formatDuration, formatEta } from './format.js';

describe('formatDistance', () => {
  it('formats sub-kilometer distances in whole meters', () => {
    expect(formatDistance(850)).toBe('850 m');
    expect(formatDistance(0)).toBe('0 m');
    expect(formatDistance(999)).toBe('999 m');
  });

  it('rounds meters to the nearest whole number', () => {
    expect(formatDistance(850.6)).toBe('851 m');
  });

  it('formats distances >= 1000 m in km with 1 decimal, German comma separator', () => {
    expect(formatDistance(12300)).toBe('12,3 km');
    expect(formatDistance(1000)).toBe('1,0 km');
    expect(formatDistance(52000)).toBe('52,0 km');
  });
});

describe('formatDuration', () => {
  it('formats sub-hour durations in minutes only', () => {
    expect(formatDuration(60)).toBe('1 Min');
    expect(formatDuration(1380)).toBe('23 Min'); // 23 min
  });

  it('formats durations >= 1h as "H Std M Min"', () => {
    expect(formatDuration(3600)).toBe('1 Std 0 Min');
    expect(formatDuration(5000)).toBe('1 Std 23 Min'); // 83.33 min -> rounds to 83 -> 1h23m
  });

  it('rounds seconds to the nearest minute', () => {
    expect(formatDuration(29)).toBe('0 Min');
    expect(formatDuration(31)).toBe('1 Min');
  });
});

describe('formatEta', () => {
  it('adds duration (seconds) to "now" and formats as HH:mm', () => {
    const now = new Date('2026-07-11T10:00:00').getTime();
    expect(formatEta(now, 30 * 60)).toBe('10:30');
  });

  it('rolls over to the next hour correctly', () => {
    const now = new Date('2026-07-11T10:45:00').getTime();
    expect(formatEta(now, 30 * 60)).toBe('11:15');
  });

  it('pads single-digit hours/minutes with a leading zero', () => {
    const now = new Date('2026-07-11T09:05:00').getTime();
    expect(formatEta(now, 0)).toBe('09:05');
  });
});
