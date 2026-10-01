/**
 * Umschalten zwischen eigener Position und ganzer Route.
 *
 * Gewünscht: „Ein Button, der zwischen aktueller Position und der gesamten
 * Route wechselt, wäre auch noch was. Der darf gerne bei geplanter oder
 * aktiver Route direkt auf dem Screen liegen. Nicht in einem Menü."
 *
 * Die Übersicht HÄLT die Kamera (`followMe.halten`): nach zehn Sekunden
 * zurück auf die Position zu springen, während man gerade die Route
 * betrachtet, wäre genau das Falsche. Zurück geht es mit demselben Knopf.
 */

import { create } from 'zustand';
import type { LatLng } from '@yapaia/shared';
import { mapController } from '../state/mapStore.js';
import { usePositionStore } from '../position/positionStore.js';
import { useRoutingStore, selectActiveRoute } from '../routing/store.js';
import { decodePolyline6 } from '../routing/polyline.js';
import { recenterOnPosition, useFollowMeStore } from './followMe.js';

export type Grenzen = [[number, number], [number, number]];

/** Das Rechteck um Route, Zwischenziele und eigene Position -- oder `null`. */
export function routenGrenzen(
  geometrie: ReadonlyArray<readonly [number, number]>,
  weitere: readonly LatLng[],
): Grenzen | null {
  let w = Infinity;
  let s = Infinity;
  let o = -Infinity;
  let n = -Infinity;
  const nimm = (lon: number, lat: number): void => {
    if (!Number.isFinite(lon) || !Number.isFinite(lat)) return;
    w = Math.min(w, lon);
    o = Math.max(o, lon);
    s = Math.min(s, lat);
    n = Math.max(n, lat);
  };
  for (const [lon, lat] of geometrie) nimm(lon, lat);
  for (const p of weitere) nimm(p.lon, p.lat);
  if (!Number.isFinite(w) || !Number.isFinite(s)) return null;
  return [
    [w, s],
    [o, n],
  ];
}

interface UebersichtState {
  aktiv: boolean;
  zeigeRoute: () => boolean;
  zurPosition: () => void;
}

export const useUebersichtStore = create<UebersichtState>((set) => ({
  aktiv: false,

  zeigeRoute: () => {
    const map = mapController.getMap();
    const routing = useRoutingStore.getState();
    const route = selectActiveRoute(routing);
    if (!map || !route) return false;
    const position = usePositionStore.getState().position;
    const grenzen = routenGrenzen(decodePolyline6(route.geometry) as Array<[number, number]>, [
      ...routing.waypoints.map((wp) => wp.latlng),
      ...(position ? [{ lat: position.lat, lon: position.lon }] : []),
    ]);
    if (!grenzen) return false;
    useFollowMeStore.getState().halten();
    map.fitBounds(grenzen, { padding: 64, duration: 600, maxZoom: 16, bearing: 0, pitch: 0 });
    set({ aktiv: true });
    return true;
  },

  zurPosition: () => {
    recenterOnPosition();
    set({ aktiv: false });
  },
}));

// Wer selbst wieder zur Position zurückkehrt (Zentrier-Knopf, Follow-Me),
// ist nicht mehr in der Übersicht.
useFollowMeStore.subscribe((s) => {
  if (!s.isPaused && useUebersichtStore.getState().aktiv) useUebersichtStore.setState({ aktiv: false });
});

declare global {
  interface Window {
    __yapaiaUebersichtStore?: typeof useUebersichtStore;
  }
}
if (typeof window !== 'undefined') {
  window.__yapaiaUebersichtStore = useUebersichtStore;
}
