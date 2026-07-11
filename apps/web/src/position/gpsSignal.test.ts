/**
 * Unit tests for gpsSignal (E02-T5, W-01).
 */

import { describe, it, expect } from 'vitest';
import { deriveSignalState, GPS_SIGNAL_LOST_THRESHOLD_MS } from './gpsSignal';

describe('deriveSignalState', () => {
  it('is "live" when connected and the last real fix is within the 3s threshold', () => {
    const now = 10_000;
    expect(
      deriveSignalState({ connected: true, lastRealUpdateTime: now - 1000, now }),
    ).toBe('live');
  });

  it('flips to "lost" once 3s have passed without a real fix', () => {
    const now = 10_000;
    expect(
      deriveSignalState({
        connected: true,
        lastRealUpdateTime: now - GPS_SIGNAL_LOST_THRESHOLD_MS - 1,
        now,
      }),
    ).toBe('lost');

    // Just under the threshold is still "live".
    expect(
      deriveSignalState({
        connected: true,
        lastRealUpdateTime: now - GPS_SIGNAL_LOST_THRESHOLD_MS + 1,
        now,
      }),
    ).toBe('live');
  });

  it('goes back to "live" once a new real fix arrives', () => {
    const now = 10_000;
    // Was lost...
    expect(
      deriveSignalState({ connected: true, lastRealUpdateTime: now - 5000, now }),
    ).toBe('lost');
    // ...a real fix just came in.
    expect(
      deriveSignalState({ connected: true, lastRealUpdateTime: now, now }),
    ).toBe('live');
  });

  it('is "lost" while disconnected, even with a very recent real fix', () => {
    const now = 10_000;
    expect(
      deriveSignalState({ connected: false, lastRealUpdateTime: now, now }),
    ).toBe('lost');
  });

  it('is "acquiring" (not "lost") before any real fix has ever arrived', () => {
    // Cold start: we have not lost a signal we never had, so the loss banner
    // must not show yet (W-01).
    expect(
      deriveSignalState({ connected: true, lastRealUpdateTime: null, now: 10_000 }),
    ).toBe('acquiring');
    expect(
      deriveSignalState({ connected: false, lastRealUpdateTime: null, now: 10_000 }),
    ).toBe('acquiring');
  });
});
