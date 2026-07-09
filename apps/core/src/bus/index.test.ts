/**
 * Unit tests for the internal EventBus (ADR-010).
 */

import { describe, it, expect, vi } from 'vitest';
import type { Position } from '@yapaja/shared';
import { EventBus } from './index.js';

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

describe('EventBus', () => {
  it('delivers to an exact-topic subscriber', () => {
    const bus = new EventBus({ isProduction: false });
    const handler = vi.fn();
    bus.subscribe('pos/update', handler);

    const pos = makePosition();
    bus.publish('pos/update', pos);

    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler).toHaveBeenCalledWith(pos, 'pos/update');
  });

  it('delivers to a wildcard subscriber (pos/*)', () => {
    const bus = new EventBus({ isProduction: false });
    const handler = vi.fn();
    bus.subscribe('pos/*', handler);

    bus.publish('pos/update', makePosition());

    expect(handler).toHaveBeenCalledTimes(1);
  });

  it('delivers to the global wildcard (*) for any topic', () => {
    const bus = new EventBus({ isProduction: false });
    const handler = vi.fn();
    bus.subscribe('*', handler);

    bus.publish('event/gps_lost', { lastSource: null });
    bus.publish('system/health', { status: 'ok', services: {} });

    expect(handler).toHaveBeenCalledTimes(2);
  });

  it('does not deliver a wildcard subscription to a non-matching prefix', () => {
    const bus = new EventBus({ isProduction: false });
    const handler = vi.fn();
    bus.subscribe('nav/*', handler);

    bus.publish('pos/update', makePosition());

    expect(handler).not.toHaveBeenCalled();
  });

  it('rejects an invalid pos/update payload by throwing outside production', () => {
    const bus = new EventBus({ isProduction: false });
    const handler = vi.fn();
    bus.subscribe('pos/update', handler);

    expect(() => bus.publish('pos/update', { lat: 999 })).toThrow();
    expect(handler).not.toHaveBeenCalled();
  });

  it('rejects a pos/update payload with fix:"none"', () => {
    const bus = new EventBus({ isProduction: false });
    const handler = vi.fn();
    bus.subscribe('pos/update', handler);

    expect(() => bus.publish('pos/update', makePosition({ fix: 'none' }))).toThrow();
    expect(handler).not.toHaveBeenCalled();
  });

  it('logs and drops an invalid payload in production instead of throwing', () => {
    const logger = { warn: vi.fn(), error: vi.fn() };
    const bus = new EventBus({ isProduction: true, logger });
    const handler = vi.fn();
    bus.subscribe('pos/update', handler);

    expect(() => bus.publish('pos/update', { lat: 999 })).not.toThrow();
    expect(handler).not.toHaveBeenCalled();
    expect(logger.error).toHaveBeenCalledTimes(1);
  });

  it('isolates a throwing handler so other handlers still run', () => {
    const bus = new EventBus({ isProduction: false });
    const good1 = vi.fn();
    const bad = vi.fn(() => {
      throw new Error('boom');
    });
    const good2 = vi.fn();

    bus.subscribe('system/health', good1);
    bus.subscribe('system/health', bad);
    bus.subscribe('system/health', good2);

    expect(() =>
      bus.publish('system/health', { status: 'ok', services: {} }),
    ).not.toThrow();

    expect(good1).toHaveBeenCalledTimes(1);
    expect(bad).toHaveBeenCalledTimes(1);
    expect(good2).toHaveBeenCalledTimes(1);
  });

  it('unsubscribe stops further delivery and drops subscriberCount to 0', () => {
    const bus = new EventBus({ isProduction: false });
    const handler = vi.fn();
    const unsubscribe = bus.subscribe('pos/update', handler);

    expect(bus.subscriberCount).toBe(1);
    unsubscribe();
    expect(bus.subscriberCount).toBe(0);

    bus.publish('pos/update', makePosition());
    expect(handler).not.toHaveBeenCalled();
  });
});
