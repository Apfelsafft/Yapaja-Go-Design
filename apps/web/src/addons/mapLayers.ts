/**
 * MapLibre adapter for add-on map layers (E09-T2, scope `map.layer.write`).
 *
 * SECURITY: every source/layer id an add-on creates is NAMESPACED
 * (`addon:{addonId}:{layerId}`) before it touches the live map. The adapter
 * tracks which namespaced ids belong to which add-on, so:
 *   - `removeLayer` can only ever remove one of THIS add-on's own layers (an
 *     add-on passing a core layer's id gets a namespaced miss, never the core
 *     layer);
 *   - `removeAllForAddon` (disable/uninstall) drops exactly that add-on's
 *     layers and nothing else -- the "layers disappear on disable" guarantee.
 *
 * ROBUSTNESS: an add-on can call `addLayer` before the map has finished
 * initializing (or across a style switch, which rebuilds the GL layers). The
 * adapter therefore records each add-on layer's DESIRED state and (re)applies
 * it whenever asked (`reapplyAll`), so a layer added "too early" still appears
 * once the map is ready. `AddonHost` calls `reapplyAll` whenever the map store's
 * map instance changes.
 *
 * The adapter talks to the map ONLY through `mapController` (E01-T2 rule: no
 * module outside `apps/web/src/map` touches maplibre-gl directly).
 */

import type { GeoJSONSourceSpecification } from 'maplibre-gl';
import type { AddLayerParams, AddMarkersParams } from '@yapaja/addon-sdk';
import { mapController } from '../state/mapStore.js';

/** The GeoJSON-or-URL shape MapLibre's geojson source accepts, without needing
 *  the global `GeoJSON` namespace (not in this project's tsc lib set). */
type GeoJsonData = GeoJSONSourceSpecification['data'];

interface DesiredLayer {
  addonId: string;
  /** Re-adds source+layer onto the CURRENT map (read live via mapController). */
  apply: () => void;
}

/** All add-on layer/source ids share this prefix so they are trivially
 *  distinguishable from core layers and from each other. */
export function addonNamespacePrefix(addonId: string): string {
  return `addon:${addonId}:`;
}

function namespaced(addonId: string, layerId: string): string {
  return `${addonNamespacePrefix(addonId)}${layerId}`;
}

export class AddonMapLayers {
  /** namespaced id -> desired state, so teardown + re-apply are both exact. */
  private readonly desired = new Map<string, DesiredLayer>();

  addLayer(addonId: string, params: AddLayerParams): void {
    const id = namespaced(addonId, params.id);
    const apply = (): void => {
      const map = mapController.getMap();
      if (!map) return;
      this.removeById(id);
      map.addSource(id, { type: 'geojson', data: params.data as GeoJsonData });
      const render = params.render ?? 'line';
      if (render === 'fill') {
        map.addLayer({ id, type: 'fill', source: id, paint: { 'fill-color': '#2563eb', 'fill-opacity': 0.3, ...(params.paint ?? {}) } });
      } else if (render === 'circle') {
        map.addLayer({ id, type: 'circle', source: id, paint: { 'circle-color': '#2563eb', 'circle-radius': 6, ...(params.paint ?? {}) } });
      } else {
        map.addLayer({ id, type: 'line', source: id, paint: { 'line-color': '#2563eb', 'line-width': 3, ...(params.paint ?? {}) } });
      }
    };
    this.desired.set(id, { addonId, apply });
    apply();
  }

  addMarkers(addonId: string, params: AddMarkersParams): void {
    const id = namespaced(addonId, params.id);
    const collection = {
      type: 'FeatureCollection',
      features: params.markers.map((m) => ({
        type: 'Feature',
        geometry: { type: 'Point', coordinates: [m.lng, m.lat] },
        properties: { id: m.id ?? null, label: m.label ?? null },
      })),
    } as GeoJsonData;
    const apply = (): void => {
      const map = mapController.getMap();
      if (!map) return;
      this.removeById(id);
      map.addSource(id, { type: 'geojson', data: collection });
      map.addLayer({ id, type: 'circle', source: id, paint: { 'circle-color': '#dc2626', 'circle-radius': 7, 'circle-stroke-width': 2, 'circle-stroke-color': '#ffffff' } });
    };
    this.desired.set(id, { addonId, apply });
    apply();
  }

  removeLayer(addonId: string, layerId: string): void {
    const id = namespaced(addonId, layerId);
    // Ownership check: refuse to touch anything not recorded as THIS add-on's.
    if (this.desired.get(id)?.addonId !== addonId) return;
    this.removeById(id);
    this.desired.delete(id);
  }

  removeAllForAddon(addonId: string): void {
    for (const [id, entry] of [...this.desired.entries()]) {
      if (entry.addonId === addonId) {
        this.removeById(id);
        this.desired.delete(id);
      }
    }
  }

  /** Re-applies every recorded add-on layer onto the current map (called when
   *  the map instance appears or is rebuilt by a style switch). */
  reapplyAll(): void {
    for (const entry of this.desired.values()) entry.apply();
  }

  private removeById(id: string): void {
    const map = mapController.getMap();
    if (!map) return;
    if (map.getLayer(id)) map.removeLayer(id);
    if (map.getSource(id)) map.removeSource(id);
  }
}

/** Module singleton shared by every add-on bridge (via `hostDeps`) so layer
 *  namespaces are globally consistent; `AddonHost` drives `reapplyAll`. */
export const addonMapLayers = new AddonMapLayers();
