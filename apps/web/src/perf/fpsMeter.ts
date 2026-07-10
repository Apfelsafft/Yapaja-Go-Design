/**
 * FPS Meter (E01-T6): Measures frame rate via requestAnimationFrame with a
 * rolling 5-second window. Only counts frames when the map camera is moving
 * (detected via map 'move'/'moveend' events) — avoids false degradation
 * during idle map periods.
 *
 * Core logic is pure: a time series of frame timestamps in → rolling fps value
 * out, separated from the rAF driving loop for testability.
 */

/**
 * Computes the rolling average FPS over the last `windowMs` milliseconds
 * from a sorted time series of frame timestamps.
 *
 * Pure function: deterministic for a given input, no side effects.
 * Returns the average FPS, or 0 if fewer than 2 frames in the window.
 */
export function computeRollingFps(frameTimestamps: number[], windowMs: number): number {
  if (frameTimestamps.length < 2) {
    return 0;
  }

  const now = frameTimestamps[frameTimestamps.length - 1];
  const cutoff = now - windowMs;

  // Find first frame within the window
  const framesInWindow = frameTimestamps.filter((ts) => ts >= cutoff);

  if (framesInWindow.length < 2) {
    return 0;
  }

  const elapsedMs = framesInWindow[framesInWindow.length - 1] - framesInWindow[0];
  const fps = (framesInWindow.length - 1) / (elapsedMs / 1000);

  return fps;
}

/**
 * Live FPS meter: tracks frame timestamps and computes rolling fps.
 * Only counts frames during periods when the map is actively moving.
 */
export class FpsMeter {
  private frameTimestamps: number[] = [];
  private readonly windowMs: number;
  private isMoving: boolean = false;
  private lastCleanupTime: number = 0;
  private readonly cleanupIntervalMs: number = 1000; // Clean up old frames periodically

  constructor(windowMs: number = 5000) {
    this.windowMs = windowMs;
  }

  /** Record that the map is actively moving (call on map 'movestart') */
  setMoving(moving: boolean): void {
    this.isMoving = moving;
  }

  /** Record a new frame (call from rAF loop). Only tracked if camera is moving. */
  recordFrame(timestamp: number): void {
    if (!this.isMoving) {
      return;
    }

    // Keep timestamps sorted (rAF callbacks are monotonic anyway, but be safe)
    this.frameTimestamps.push(timestamp);

    // Periodically clean up old timestamps outside the window
    if (timestamp - this.lastCleanupTime > this.cleanupIntervalMs) {
      const cutoff = timestamp - this.windowMs;
      this.frameTimestamps = this.frameTimestamps.filter((ts) => ts >= cutoff);
      this.lastCleanupTime = timestamp;
    }
  }

  /** Get the current rolling FPS value */
  getRollingFps(): number {
    return computeRollingFps(this.frameTimestamps, this.windowMs);
  }

  /** Reset (for testing) */
  reset(): void {
    this.frameTimestamps = [];
    this.isMoving = false;
    this.lastCleanupTime = 0;
  }
}
