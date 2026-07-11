/**
 * Unit tests for DeadReckoningController (E02-T5, W-01).
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { Position } from '@yapaja/shared';
import { EventBus } from '../bus/index.js';
import { PositionService } from './service.js';
import {
  DeadReckoningController,
  noopDeadReckoningProvider,
  type DeadReckoningProvider,
  type ExtrapolatedPosition,
} from './deadReckoning.js';

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

/** Stub provider that always extrapolates (so we can observe the tick loop directly). */
const alwaysExtrapolateProvider: DeadReckoningProvider = {
  extrapolate: (lastFix) => ({ ...lastFix, ts: new Date().toISOString() }),
};

describe('DeadReckoningController', () => {
  let bus: EventBus;
  let service: PositionService;
  let controller: DeadReckoningController | null;

  beforeEach(() => {
    vi.useFakeTimers();
    bus = new EventBus({ isProduction: false });
    controller = null;
  });

  afterEach(() => {
    controller?.dispose();
    service.dispose();
    vi.useRealTimers();
  });

  it('(a) stops publishing pos/extrapolated once maxWindowMs has elapsed since the loss', () => {
    service = new PositionService({ bus, checkIntervalMs: 100, activeWindowMs: 5000 });
    controller = new DeadReckoningController({
      bus,
      service,
      provider: alwaysExtrapolateProvider,
      maxWindowMs: 30_000,
      rateHz: 1,
    });
    const extrapolated: ExtrapolatedPosition[] = [];
    bus.subscribe('pos/extrapolated', (payload) => extrapolated.push(payload));

    service.pushFix('gpsd', makePosition({ source: 'gpsd' }));
    // Let gpsd go stale -> PositionService fires event/gps_lost (~5000ms,
    // its activeWindowMs) which starts the DR controller's 1Hz tick loop;
    // advance past its first tick too (another ~1000ms) so at least one
    // pos/extrapolated has actually been published.
    vi.advanceTimersByTime(6300);
    expect(extrapolated.length).toBeGreaterThan(0);

    // Cross the 30s-since-loss boundary by a wide margin.
    vi.advanceTimersByTime(40_000);
    extrapolated.length = 0;

    // No further publishes once the window has closed.
    vi.advanceTimersByTime(5000);
    expect(extrapolated.length).toBe(0);
  });

  it('(b) never publishes pos/extrapolated with the noop provider -- the puck freezes without a route', () => {
    service = new PositionService({ bus, checkIntervalMs: 100, activeWindowMs: 5000 });
    controller = new DeadReckoningController({ bus, service }); // default provider = noop
    const extrapolated = vi.fn();
    bus.subscribe('pos/extrapolated', extrapolated);

    service.pushFix('gpsd', makePosition({ source: 'gpsd' }));
    // Advance well past both activeWindowMs (loss detection) and the 30s DR window.
    vi.advanceTimersByTime(36_000);

    expect(extrapolated).not.toHaveBeenCalled();
    expect(noopDeadReckoningProvider.extrapolate(makePosition(), 1000)).toBeNull();
  });

  it('(c) a real pos/update fix stops extrapolation', () => {
    service = new PositionService({ bus, checkIntervalMs: 100, activeWindowMs: 5000 });
    controller = new DeadReckoningController({
      bus,
      service,
      provider: alwaysExtrapolateProvider,
      rateHz: 1,
    });
    const extrapolated: ExtrapolatedPosition[] = [];
    bus.subscribe('pos/extrapolated', (payload) => extrapolated.push(payload));

    service.pushFix('gpsd', makePosition({ source: 'gpsd' }));
    vi.advanceTimersByTime(6300); // triggers event/gps_lost + at least one DR tick
    expect(extrapolated.length).toBeGreaterThan(0);

    extrapolated.length = 0;
    // A real fix comes back -> PositionService republishes pos/update.
    service.pushFix('gpsd', makePosition({ source: 'gpsd' }));
    vi.advanceTimersByTime(5000);
    expect(extrapolated.length).toBe(0);
  });

  it('(c) event/gps_source_changed with a non-null "to" stops extrapolation', () => {
    // A very high activeWindowMs keeps PositionService's own staleness
    // detection from firing during this test, so event/gps_lost /
    // event/gps_source_changed can be driven manually and in isolation.
    service = new PositionService({ bus, checkIntervalMs: 100, activeWindowMs: 1_000_000 });
    controller = new DeadReckoningController({
      bus,
      service,
      provider: alwaysExtrapolateProvider,
      rateHz: 1,
    });
    const extrapolated: ExtrapolatedPosition[] = [];
    bus.subscribe('pos/extrapolated', (payload) => extrapolated.push(payload));

    service.pushFix('gpsd', makePosition({ source: 'gpsd' })); // service.getLast() now returns this fix
    bus.publish('event/gps_lost', { lastSource: 'gpsd' });
    vi.advanceTimersByTime(1200);
    expect(extrapolated.length).toBeGreaterThan(0);

    extrapolated.length = 0;
    bus.publish('event/gps_source_changed', { from: null, to: 'gpsd' });
    vi.advanceTimersByTime(3000);
    expect(extrapolated.length).toBe(0);
  });

  it('(d) the extrapolated payload carries extrapolated:true and preserves source', () => {
    service = new PositionService({ bus, checkIntervalMs: 100, activeWindowMs: 5000 });
    controller = new DeadReckoningController({
      bus,
      service,
      provider: alwaysExtrapolateProvider,
      rateHz: 1,
    });
    const received: ExtrapolatedPosition[] = [];
    bus.subscribe('pos/extrapolated', (payload) => received.push(payload));

    service.pushFix('gpsd', makePosition({ source: 'gpsd' }));
    vi.advanceTimersByTime(6300); // triggers event/gps_lost + at least one DR tick

    expect(received.length).toBeGreaterThan(0);
    expect(received[0].extrapolated).toBe(true);
    expect(received[0].source).toBe('gpsd');
  });

  // (e) The future MQTT bridge (E08) only republishes `pos/update` as
  // `yapaja/position` -- it must never treat `pos/extrapolated` the same
  // way, or a dead-reckoned guess would be forwarded to external consumers
  // as a real fix. See DeadReckoningController's module docstring
  // (deadReckoning.ts) for the same invariant on the publishing side.
  it.todo(
    'MQTT-Mapping (E08) filtert extrapolierte Positionen — pos/extrapolated wird nicht als yapaja/position publiziert',
  );
});
