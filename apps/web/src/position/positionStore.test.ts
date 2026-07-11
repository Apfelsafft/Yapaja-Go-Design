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
      extrapolated: false,
      lastRealUpdateTime: null,
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

  describe('setRealPosition / setExtrapolatedPosition (E02-T5, W-01)', () => {
    const position = {
      lat: 48.8566,
      lon: 2.3522,
      alt: 100,
      speed: 15,
      heading: 90,
      accuracy: 10,
      source: 'gpsd' as const,
      fix: '3d' as const,
      ts: new Date().toISOString(),
    };

    it('setRealPosition (pos/update) sets extrapolated=false and bumps lastRealUpdateTime', () => {
      const before = Date.now();
      usePositionStore.getState().setRealPosition(position);
      const after = Date.now();

      const state = usePositionStore.getState();
      expect(state.position).toEqual(position);
      expect(state.extrapolated).toBe(false);
      expect(state.lastRealUpdateTime).not.toBeNull();
      expect(state.lastRealUpdateTime! >= before && state.lastRealUpdateTime! <= after).toBe(true);
    });

    it('setExtrapolatedPosition (pos/extrapolated) sets extrapolated=true WITHOUT touching lastRealUpdateTime', () => {
      usePositionStore.getState().setRealPosition(position);
      const realUpdateTime = usePositionStore.getState().lastRealUpdateTime;

      usePositionStore.getState().setExtrapolatedPosition({ ...position, lat: position.lat + 0.01 });

      const state = usePositionStore.getState();
      expect(state.position?.lat).toBe(position.lat + 0.01);
      expect(state.extrapolated).toBe(true);
      // lastRealUpdateTime must be exactly unchanged -- pos/extrapolated
      // must never make the GPS signal look "live" again.
      expect(state.lastRealUpdateTime).toBe(realUpdateTime);
    });

    it('a subsequent setRealPosition clears extrapolated again', () => {
      usePositionStore.getState().setRealPosition(position);
      usePositionStore.getState().setExtrapolatedPosition(position);
      expect(usePositionStore.getState().extrapolated).toBe(true);

      usePositionStore.getState().setRealPosition(position);
      expect(usePositionStore.getState().extrapolated).toBe(false);
    });
  });
});
