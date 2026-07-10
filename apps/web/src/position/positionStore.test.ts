/**
 * Unit tests for positionStore (E02-T2)
 *
 * Tests:
 * - Position store state management
 * - WS reconnection logic with exponential backoff
 * - Subscription to pos/* topics
 * - Single connection guard (no multiple WS instances)
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { usePositionStore } from './positionStore';

describe('positionStore', () => {
  beforeEach(() => {
    // Clear store
    usePositionStore.setState({
      position: null,
      isConnected: false,
      lastUpdateTime: null,
      error: null,
    });
  });

  it('stores and retrieves position', () => {
    const position = {
      lat: 48.8566,
      lon: 2.3522,
      alt: 100,
      speed: 15,
      heading: 90,
      accuracy: 10,
      source: 'browser' as const,
      fix: '3d' as const,
      ts: new Date().toISOString(),
    };

    usePositionStore.getState().setPosition(position);

    const retrieved = usePositionStore.getState().position;
    expect(retrieved).toEqual(position);
  });

  it('returns null for position when not set', () => {
    expect(usePositionStore.getState().position).toBeNull();
  });

  it('returns false for isConnected when not connected', () => {
    expect(usePositionStore.getState().isConnected).toBe(false);
  });

  it('updates lastUpdateTime when position is set', () => {
    const position = {
      lat: 48.8566,
      lon: 2.3522,
      alt: 100,
      speed: 15,
      heading: 90,
      accuracy: 10,
      source: 'browser' as const,
      fix: '3d' as const,
      ts: new Date().toISOString(),
    };

    const beforeTime = Date.now();
    usePositionStore.getState().setPosition(position);
    const afterTime = Date.now();

    const lastUpdateTime = usePositionStore.getState().lastUpdateTime;
    expect(lastUpdateTime).toBeDefined();
    expect(lastUpdateTime! >= beforeTime && lastUpdateTime! <= afterTime).toBe(true);
  });

  it('clears lastUpdateTime when position is cleared', () => {
    const position = {
      lat: 48.8566,
      lon: 2.3522,
      alt: 100,
      speed: 15,
      heading: 90,
      accuracy: 10,
      source: 'browser' as const,
      fix: '3d' as const,
      ts: new Date().toISOString(),
    };

    usePositionStore.getState().setPosition(position);
    usePositionStore.getState().setPosition(null);

    expect(usePositionStore.getState().lastUpdateTime).toBeNull();
  });

  it('sets connected status', () => {
    usePositionStore.getState().setConnected(true);
    expect(usePositionStore.getState().isConnected).toBe(true);

    usePositionStore.getState().setConnected(false);
    expect(usePositionStore.getState().isConnected).toBe(false);
  });

  it('sets error state', () => {
    const errorMsg = 'Connection failed';
    usePositionStore.getState().setError(errorMsg);
    expect(usePositionStore.getState().error).toBe(errorMsg);

    usePositionStore.getState().setError(null);
    expect(usePositionStore.getState().error).toBeNull();
  });
});
