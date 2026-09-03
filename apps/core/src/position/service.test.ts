/**
 * Unit tests for PositionService: source failover, rate-limited pos/update
 * publishing, and gps_lost/gps_source_changed transitions.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { Position } from '@yapaja/shared';
import { EventBus } from '../bus/index.js';
import { PositionService, type PositionSourceName } from './service.js';

function makePosition(overrides: Partial<Position> = {}): Position {
  return {
    lat: 52.5,
    lon: 13.4,
    alt: 34,
    speed: 10,
    heading: 90,
    accuracy: 5,
    source: 'gpsd',
    fix: '3d',
    ts: new Date().toISOString(),
    ...overrides,
  };
}

describe('PositionService', () => {
  let bus: EventBus;
  let service: PositionService;

  beforeEach(() => {
    vi.useFakeTimers();
    bus = new EventBus({ isProduction: false });
  });

  afterEach(() => {
    service.dispose();
    vi.useRealTimers();
  });

  it('selects the highest-priority active source', () => {
    service = new PositionService({ bus, checkIntervalMs: 100 });

    service.pushFix('browser', makePosition({ source: 'browser', lat: 1 }));
    expect(service.getActiveSource()).toBe('browser');

    service.pushFix('gpsd', makePosition({ source: 'gpsd', lat: 2 }));
    expect(service.getActiveSource()).toBe('gpsd');
    expect(service.getLast()?.lat).toBe(2);
  });

  it('fails over to the next active source after the priority source goes stale, publishing gps_source_changed', () => {
    service = new PositionService({ bus, checkIntervalMs: 100, activeWindowMs: 5000 });
    const changed = vi.fn();
    bus.subscribe('event/gps_source_changed', changed);

    // gpsd is priority 1, browser priority 2. Both start delivering fixes.
    service.pushFix('gpsd', makePosition({ source: 'gpsd' }));
    service.pushFix('browser', makePosition({ source: 'browser' }));
    expect(service.getActiveSource()).toBe('gpsd');
    changed.mockClear();

    // Keep browser fresh, but stop feeding gpsd, for just over the 5s window.
    for (let i = 0; i < 5; i++) {
      vi.advanceTimersByTime(1000);
      service.pushFix('browser', makePosition({ source: 'browser' }));
    }
    vi.advanceTimersByTime(200); // let the periodic staleness check run past 5000ms

    expect(service.getActiveSource()).toBe('browser');
    expect(changed).toHaveBeenCalledWith(
      expect.objectContaining({ from: 'gpsd', to: 'browser' }),
      'event/gps_source_changed',
    );
  });

  it('publishes event/gps_lost exactly once per loss transition', () => {
    service = new PositionService({ bus, checkIntervalMs: 100, activeWindowMs: 5000 });
    const lost = vi.fn();
    bus.subscribe('event/gps_lost', lost);

    service.pushFix('gpsd', makePosition({ source: 'gpsd' }));
    expect(service.getActiveSource()).toBe('gpsd');

    // Let gpsd go stale without any other source active.
    vi.advanceTimersByTime(5200);
    expect(lost).toHaveBeenCalledTimes(1);

    // Further ticks with still no fix must not re-fire.
    vi.advanceTimersByTime(3000);
    expect(lost).toHaveBeenCalledTimes(1);

    // Recover, then lose again -> exactly one more gps_lost.
    service.pushFix('gpsd', makePosition({ source: 'gpsd' }));
    expect(service.getActiveSource()).toBe('gpsd');
    vi.advanceTimersByTime(5200);
    expect(lost).toHaveBeenCalledTimes(2);
  });

  it('never fires gps_lost when no source ever delivered a fix', () => {
    service = new PositionService({ bus, checkIntervalMs: 100, activeWindowMs: 5000 });
    const lost = vi.fn();
    bus.subscribe('event/gps_lost', lost);

    vi.advanceTimersByTime(10000);
    expect(lost).not.toHaveBeenCalled();
  });

  it('rate-limits pos/update to at most rateHz publishes per second, last fix wins', () => {
    service = new PositionService({ bus, rateHz: 5, checkIntervalMs: 50, activeWindowMs: 5000 });
    const received: Position[] = [];
    bus.subscribe('pos/update', (payload) => received.push(payload));

    // 10 fixes/s, at t=0,100,...,900ms (no trailing advance past the last fix).
    for (let i = 0; i < 10; i++) {
      service.pushFix('gpsd', makePosition({ source: 'gpsd', lat: i }));
      if (i < 9) vi.advanceTimersByTime(100);
    }

    expect(received.length).toBeLessThanOrEqual(5);
    expect(received.length).toBeGreaterThan(1); // throttling actually happened, not a single publish
    // Last-fix-wins: the final published position must be one of the later fixes, not fix 0.
    expect(received[received.length - 1].lat).toBeGreaterThan(0);
  });

  it('never publishes two pos/update events less than 200ms apart at the 5 Hz limit', () => {
    service = new PositionService({ bus, rateHz: 5, checkIntervalMs: 50, activeWindowMs: 5000 });
    const publishTimes: number[] = [];
    bus.subscribe('pos/update', () => publishTimes.push(Date.now()));

    for (let i = 0; i < 10; i++) {
      service.pushFix('gpsd', makePosition({ source: 'gpsd', lat: i }));
      vi.advanceTimersByTime(100);
    }
    vi.advanceTimersByTime(500); // flush any trailing pending publish

    for (let i = 1; i < publishTimes.length; i++) {
      expect(publishTimes[i] - publishTimes[i - 1]).toBeGreaterThanOrEqual(200);
    }
  });

  it('never publishes a pos/update for a fix with fix:"none"', () => {
    service = new PositionService({ bus, checkIntervalMs: 100 });
    const received: Position[] = [];
    bus.subscribe('pos/update', (payload) => received.push(payload));

    service.pushFix('gpsd', makePosition({ source: 'gpsd', fix: 'none' }));

    expect(received).toHaveLength(0);
    expect(service.getActiveSource()).toBeNull();
    expect(service.getLast()).toBeNull();
  });

  it('drops implausible fixes (fails checkPosition) without publishing or activating', () => {
    service = new PositionService({ bus, checkIntervalMs: 100 });
    const received: Position[] = [];
    bus.subscribe('pos/update', (payload) => received.push(payload));

    // speed of 100 m/s => 360 km/h, far above the 250 km/h plausibility ceiling.
    service.pushFix('gpsd', makePosition({ source: 'gpsd', speed: 100 }));

    expect(received).toHaveLength(0);
    expect(service.getActiveSource()).toBeNull();
  });

  it('setForcedSource pins the active source regardless of priority', () => {
    service = new PositionService({ bus, checkIntervalMs: 100 });

    service.pushFix('gpsd', makePosition({ source: 'gpsd' }));
    service.pushFix('browser', makePosition({ source: 'browser' }));
    expect(service.getActiveSource()).toBe('gpsd');

    service.setForcedSource('browser');
    expect(service.getForcedSource()).toBe('browser');
    expect(service.getActiveSource()).toBe('browser');
    expect(service.isSourceSelectable('browser')).toBe(true);
    expect(service.isSourceSelectable('gpsd')).toBe(false);

    service.setForcedSource(null);
    expect(service.getActiveSource()).toBe('gpsd');
  });

  it('getSources reports active flags and lastFixTs for all known source names', () => {
    service = new PositionService({ bus, checkIntervalMs: 100, activeWindowMs: 5000 });

    service.pushFix('simulator', makePosition({ source: 'simulator' }));

    const sources = service.getSources();
    const names = sources.map((s) => s.name).sort();
    expect(names).toEqual<PositionSourceName[]>(
      ['browser', 'gpsd', 'ha_tracker', 'simulator'].sort() as PositionSourceName[],
    );

    const simulator = sources.find((s) => s.name === 'simulator');
    expect(simulator?.active).toBe(true);
    expect(simulator?.lastFixTs).not.toBeNull();

    const gpsd = sources.find((s) => s.name === 'gpsd');
    expect(gpsd?.active).toBe(false);
    expect(gpsd?.lastFixTs).toBeNull();
  });
});
