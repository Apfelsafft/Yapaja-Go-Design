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
  /**
   * Gleichmaessig bewegen statt sanft an- und abschwellen.
   *
   * ─── DIE MELDUNG ────────────────────────────────────────────────────────
   * „Auch die Führung der Route ist noch irgendwie hakelig. Der blaue Punkt
   * folgt der blauen Linie aber es läuft nicht unbedingt smooth. Schwer zu
   * beschreiben."
   *
   * ─── DIE URSACHE ────────────────────────────────────────────────────────
   * `easeTo` ohne `easing` nimmt MapLibres Vorgabe, und die ist eine
   * Ein-/Ausblendkurve (langsam los, schnell in der Mitte, langsam ans Ziel).
   * Fuer EINE Bewegung ist das genau richtig -- man sieht, dass sie anfaengt
   * und aufhoert.
   *
   * Beim Folgen waehrend der Fahrt ist es falsch. Dort reiht sich eine
   * Bewegung an die naechste, eine je Positionsmeldung. Jede bremst am Ende
   * auf null ab, und die naechste beschleunigt wieder aus dem Stand: die
   * Karte PULSIERT im Sekundentakt, obwohl das Fahrzeug gleichmaessig faehrt.
   *
   * Das ist nicht dasselbe wie das Springen, das `followAnimationMs` behoben
   * hat -- die Bewegung war danach durchgehend, aber eben ungleichmaessig.
   * Genau dieser Rest ist „schwer zu beschreiben".
   *
   * ─── WARUM ES NICHT DIE VORGABE IST ─────────────────────────────────────
   * Weil es nur fuers Folgen stimmt. Ein Sprung zur Position nach der Suche
   * oder ueber den Zurueck-Knopf SOLL abbremsen; linear sieht er aus, als
   * haette jemand die Karte gerissen.
   */
  stetig?: boolean;
}

/**
 * Gleichfoermig: der Fortschritt ist die Zeit.
 *
 * Steht als benannte Konstante da und nicht als `t => t` im Aufruf, damit sie
 * bei jedem Aufruf DIESELBE Funktion ist -- MapLibre vergleicht
 * Animationsoptionen an mehreren Stellen, und eine jedes Mal neu erzeugte
 * Funktion ist nie gleich.
 */
const GLEICHFOERMIG = (t: number): number => t;

export type MapEventListener<T extends keyof MapEventType> = (event: MapEventType[T]) => void;

interface MapControllerState {
  map: MapLibreMap | null;
  /** Registers the live Map instance. Called once by MapView after `new maplibregl.Map(...)`. */
  setMap: (map: MapLibreMap | null) => void;
  /** Returns the current Map instance, or null if the map has not initialized (or was torn down). */
  getMap: () => MapLibreMap | null;
  /** Moves the camera. No-ops silently if no map is registered yet. */
  setCamera: (camera: CameraOptions, options?: SetCameraOptions) => void;
  /**
   * Schiebt den Kartenmittelpunkt im Bild nach unten und zur Seite (Raender
   * OBEN, LINKS, RECHTS in Bildpunkten) -- waehrend der Fahrt sitzt das
   * Fahrzeug dadurch in der Mitte eines unteren Viertels statt in der
   * Bildmitte. Siehe `map/drivePadding.ts`.
   *
   * `null` stellt den Zustand ohne Verschiebung wieder her.
   */
  setDrivePadding: (raender: { top: number; left: number; right: number } | null) => void;
  /** Die Breite der Kartenflaeche in CSS-Bildpunkten, oder `null` ohne Karte. */
  getWidthPx: () => number | null;
  /** Die Hoehe der Kartenflaeche in CSS-Bildpunkten, oder `null` ohne Karte. */
  getHeightPx: () => number | null;
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
      map.easeTo({
        ...camera,
        duration: options.duration,
        ...(options.stetig ? { easing: GLEICHFOERMIG } : {}),
      });
    } else {
      map.jumpTo(camera);
    }
  },

  setDrivePadding: (raender) => {
    const map = get().map;
    if (!map) {
      return;
    }
    // Nur `top`, `left` und `right` anfassen: `bottom` gehoert anderen, und
    // es hier mitzusetzen hiesse, dessen Wert stillschweigend zu
    // ueberschreiben.
    map.setPadding({
      ...map.getPadding(),
      top: raender?.top ?? 0,
      left: raender?.left ?? 0,
      right: raender?.right ?? 0,
    });
  },

  getWidthPx: () => {
    const map = get().map;
    if (!map) {
      return null;
    }
    const breite = map.getCanvas().clientWidth;
    return Number.isFinite(breite) && breite > 0 ? breite : null;
  },

  getHeightPx: () => {
    const map = get().map;
    if (!map) {
      return null;
    }
    const hoehe = map.getCanvas().clientHeight;
    return Number.isFinite(hoehe) && hoehe > 0 ? hoehe : null;
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
  setDrivePadding: (raender: { top: number; left: number; right: number } | null): void =>
    useMapStore.getState().setDrivePadding(raender),
  getWidthPx: (): number | null => useMapStore.getState().getWidthPx(),
  getHeightPx: (): number | null => useMapStore.getState().getHeightPx(),
  on: <T extends keyof MapEventType>(type: T, listener: MapEventListener<T>): void =>
    useMapStore.getState().on(type, listener),
  off: <T extends keyof MapEventType>(type: T, listener: MapEventListener<T>): void =>
    useMapStore.getState().off(type, listener),
};
