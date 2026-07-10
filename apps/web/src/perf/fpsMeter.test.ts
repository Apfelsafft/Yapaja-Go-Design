/**
 * Unit tests for FpsMeter (E01-T6)
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { FpsMeter, computeRollingFps } from './fpsMeter';

describe('computeRollingFps', () => {
  it('returns 0 for empty array', () => {
    expect(computeRollingFps([], 5000)).toBe(0);
  });

  it('returns 0 for single frame', () => {
    expect(computeRollingFps([1000], 5000)).toBe(0);
  });

  it('returns 0 when no frames in window', () => {
    const timestamps = [1000, 2000];
    expect(computeRollingFps(timestamps, 100)).toBe(0);
  });

  it('computes fps correctly for frames in window', () => {
    // 2 frames 100ms apart = 10 fps
    const timestamps = [1000, 1100];
    const fps = computeRollingFps(timestamps, 5000);
    expect(fps).toBeCloseTo(10, 1);
  });

  it('computes fps from multiple frames', () => {
    // 6 frames at 0, 50, 100, 150, 200, 250ms = 5 intervals of 50ms = 20 fps
    const timestamps = [1000, 1050, 1100, 1150, 1200, 1250];
    const fps = computeRollingFps(timestamps, 5000);
    expect(fps).toBeCloseTo(20, 1);
  });

  it('excludes frames outside the window', () => {
    // Window 200ms, last frame at 1200: cutoff = 1200 - 200 = 1000
    // Frames >= 1000: [1000, 1050, 1100, 1150, 1200] = 5 frames
    // Intervals: 50+50+50+50 = 200ms, FPS = 4 / 0.2s = 20 fps
    const timestamps = [1000, 1050, 1100, 1150, 1200];
    const fps = computeRollingFps(timestamps, 200);
    expect(fps).toBeCloseTo(20, 1);
  });
});

describe('FpsMeter', () => {
  let meter: FpsMeter;

  beforeEach(() => {
    meter = new FpsMeter(5000);
  });

  it('returns 0 fps when no frames recorded', () => {
    const fps = meter.getRollingFps();
    expect(fps).toBe(0);
  });

  it('returns 0 fps when camera is not moving', () => {
    meter.setMoving(false);
    meter.recordFrame(1000);
    meter.recordFrame(1100);
    const fps = meter.getRollingFps();
    expect(fps).toBe(0);
  });

  it('records frames when camera is moving', () => {
    meter.setMoving(true);
    meter.recordFrame(1000);
    meter.recordFrame(1100);
    meter.recordFrame(1200);
    const fps = meter.getRollingFps();
    expect(fps).toBeCloseTo(10, 1); // 2 intervals of 100ms = 10 fps
  });

  it('stops recording when camera stops moving', () => {
    meter.setMoving(true);
    meter.recordFrame(1000);
    meter.recordFrame(1100);
    meter.setMoving(false);
    meter.recordFrame(1200); // This should not be recorded
    const fps = meter.getRollingFps();
    expect(fps).toBeCloseTo(10, 1); // Still 2 frames, 10 fps
  });

  it('resumes recording when camera moves again', () => {
    meter.setMoving(true);
    meter.recordFrame(1000);
    meter.recordFrame(1100);
    meter.setMoving(false);
    meter.recordFrame(1200); // Not recorded
    meter.setMoving(true);
    meter.recordFrame(1300); // Now recorded again
    meter.recordFrame(1400);
    const fps = meter.getRollingFps();
    // Only frames at 1000, 1100, 1300, 1400 are recorded
    // 3 intervals: 100ms + 200ms + 100ms = 400ms total, 4 frames
    // fps = 3 / 0.4 = 7.5 fps
    expect(fps).toBeCloseTo(7.5, 1);
  });

  it('respects the rolling window', () => {
    // Create a 100ms window
    const windowMeter = new FpsMeter(100);
    windowMeter.setMoving(true);
    windowMeter.recordFrame(1000);
    windowMeter.recordFrame(1050);
    windowMeter.recordFrame(1100); // Now only this and next are in window
    windowMeter.recordFrame(1150);
    const fps = windowMeter.getRollingFps();
    // Frames in window: 1100, 1150 = 1 interval of 50ms = 20 fps
    expect(fps).toBeCloseTo(20, 1);
  });

  it('resets state correctly', () => {
    meter.setMoving(true);
    meter.recordFrame(1000);
    meter.recordFrame(1100);
    meter.reset();
    expect(meter.getRollingFps()).toBe(0);
  });
});
