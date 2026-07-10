/**
 * MapController: the single point through which the rest of the app talks to
 * the MapLibre `Map` instance.
 *
 * Per E01-T2, other modules (position tracking, routing, …) must never touch
 * `maplibre-gl` directly — they only ever call `setCamera`, `getMap`, `on`
 * and `off` through this store. That keeps the MapLibre dependency isolated
 * to `apps/web/src/map/` and makes it possible to swap/mocked the map in
 * tests without touching consumers.
 */

import { create } from 'zustand';
import type { Map as MapLibreMap, MapEventType } from 'maplibre-gl';

export interface CameraOptions {
  center?: [number, number];
  zoom?: number;
  bearing?: number;
  pitch?: number;
}

export interface SetCameraOptions {
  /** Animate the transition (`easeTo`) instead of jumping instantly (`jumpTo`, the default). */
  animate?: boolean;
  /** Animation duration in ms, only used when `animate` is true. */
  duration?: number;
}

export type MapEventListener<T extends keyof MapEventType> = (event: MapEventType[T]) => void;

interface MapControllerState {
  map: MapLibreMap | null;
  /** Registers the live Map instance. Called once by MapView after `new maplibregl.Map(...)`. */
  setMap: (map: MapLibreMap | null) => void;
  /** Returns the current Map instance, or null if the map has not initialized (or was torn down). */
  getMap: () => MapLibreMap | null;
  /** Moves the camera. No-ops silently if no map is registered yet. */
  setCamera: (camera: CameraOptions, options?: SetCameraOptions) => void;
  /** Subscribes to a MapLibre map event. No-ops silently if no map is registered yet. */
  on: <T extends keyof MapEventType>(type: T, listener: MapEventListener<T>) => void;
  /** Unsubscribes from a MapLibre map event. No-ops silently if no map is registered yet. */
  off: <T extends keyof MapEventType>(type: T, listener: MapEventListener<T>) => void;
}

export const useMapStore = create<MapControllerState>((set, get) => ({
  map: null,

  setMap: (map) => set({ map }),

  getMap: () => get().map,

  setCamera: (camera, options) => {
    const map = get().map;
    if (!map) {
      return;
    }
    if (options?.animate) {
      map.easeTo({ ...camera, duration: options.duration });
    } else {
      map.jumpTo(camera);
    }
  },

  on: (type, listener) => {
    get().map?.on(type, listener);
  },

  off: (type, listener) => {
    get().map?.off(type, listener);
  },
}));

/**
 * Non-hook accessor for use outside React components/render (e.g. imperative
 * code in services). Prefer `useMapStore` inside components so re-renders
 * happen correctly.
 */
export const mapController = {
  setMap: (map: MapLibreMap | null): void => useMapStore.getState().setMap(map),
  getMap: (): MapLibreMap | null => useMapStore.getState().getMap(),
  setCamera: (camera: CameraOptions, options?: SetCameraOptions): void =>
    useMapStore.getState().setCamera(camera, options),
  on: <T extends keyof MapEventType>(type: T, listener: MapEventListener<T>): void =>
    useMapStore.getState().on(type, listener),
  off: <T extends keyof MapEventType>(type: T, listener: MapEventListener<T>): void =>
    useMapStore.getState().off(type, listener),
};
