import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { Map as MapLibreMap } from 'maplibre-gl';
import { useMapStore, mapController } from './mapStore';

/**
 * MapLibre itself is never rendered in these tests (no WebGL in jsdom/node)
 * — see MapView, which is exercised end-to-end by Playwright instead. Here
 * we only verify the MapController's own logic against a mocked Map.
 */
function createMockMap(): MapLibreMap {
  return {
    jumpTo: vi.fn(),
    easeTo: vi.fn(),
    on: vi.fn(),
    off: vi.fn(),
  } as unknown as MapLibreMap;
}

describe('mapStore (MapController)', () => {
  beforeEach(() => {
    useMapStore.setState({ map: null });
  });

  it('starts with no map registered', () => {
    expect(useMapStore.getState().getMap()).toBeNull();
  });

  it('setMap registers the instance and getMap returns it', () => {
    const map = createMockMap();
    useMapStore.getState().setMap(map);
    expect(useMapStore.getState().getMap()).toBe(map);
  });

  it('setMap(null) clears the registered instance', () => {
    const map = createMockMap();
    useMapStore.getState().setMap(map);
    useMapStore.getState().setMap(null);
    expect(useMapStore.getState().getMap()).toBeNull();
  });

  it('setCamera is a no-op when no map is registered (does not throw)', () => {
    expect(() => useMapStore.getState().setCamera({ zoom: 10 })).not.toThrow();
  });

  it('setCamera without animate calls map.jumpTo with the given camera options', () => {
    const map = createMockMap();
    useMapStore.getState().setMap(map);

    useMapStore.getState().setCamera({ center: [7.5, 51.0], zoom: 12, bearing: 45, pitch: 30 });

    expect(map.jumpTo).toHaveBeenCalledTimes(1);
    expect(map.jumpTo).toHaveBeenCalledWith({
      center: [7.5, 51.0],
      zoom: 12,
      bearing: 45,
      pitch: 30,
    });
    expect(map.easeTo).not.toHaveBeenCalled();
  });

  it('setCamera with animate:true calls map.easeTo (not jumpTo) with duration merged in', () => {
    const map = createMockMap();
    useMapStore.getState().setMap(map);

    useMapStore.getState().setCamera({ zoom: 14 }, { animate: true, duration: 500 });

    expect(map.easeTo).toHaveBeenCalledTimes(1);
    expect(map.easeTo).toHaveBeenCalledWith({ zoom: 14, duration: 500 });
    expect(map.jumpTo).not.toHaveBeenCalled();
  });

  it('on() registers a listener on the underlying map', () => {
    const map = createMockMap();
    useMapStore.getState().setMap(map);
    const listener = vi.fn();

    useMapStore.getState().on('zoomend', listener);

    expect(map.on).toHaveBeenCalledWith('zoomend', listener);
  });

  it('on() is a no-op when no map is registered (does not throw)', () => {
    const listener = vi.fn();
    expect(() => useMapStore.getState().on('zoomend', listener)).not.toThrow();
  });

  it('off() unregisters a listener on the underlying map', () => {
    const map = createMockMap();
    useMapStore.getState().setMap(map);
    const listener = vi.fn();

    useMapStore.getState().off('moveend', listener);

    expect(map.off).toHaveBeenCalledWith('moveend', listener);
  });

  it('off() is a no-op when no map is registered (does not throw)', () => {
    const listener = vi.fn();
    expect(() => useMapStore.getState().off('moveend', listener)).not.toThrow();
  });

  it('mapController exposes the same underlying store state (non-hook accessor)', () => {
    const map = createMockMap();
    mapController.setMap(map);
    expect(mapController.getMap()).toBe(map);
    expect(useMapStore.getState().map).toBe(map);
  });
});
