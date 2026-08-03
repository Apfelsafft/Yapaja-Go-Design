/**
 * POI-Overlay "Stellplätze" (E09-T5, docs/05 §6.1) -- UI entry point (Type A,
 * `ui.entry`). Runs inside the sandboxed add-on iframe
 * (`apps/web/src/addons/AddonHost.tsx`) and talks to the host EXCLUSIVELY
 * through `@yapaja/addon-sdk`'s `connectAddon()` -- no raw `fetch`, no raw
 * `postMessage` anywhere in this file (verified by
 * `addons-examples/no-raw-transport.test.ts`).
 *
 * What it demonstrates (docs/05 §6, "living documentation" for the SDK):
 *  - `map.layer.write`: pushes the ~200 bundled campsite POIs as a GeoJSON
 *    marker layer, re-pushed whenever the settings panel's category filter
 *    changes.
 *  - `widget.register`/`widgets.update`: a small side-panel widget mirroring
 *    the currently selected POI (the widget slot only renders `text`, see
 *    `AddonWidgetView.tsx`, so the FULL detail view -- description,
 *    amenities, price, the "Route hierhin" button -- lives in this iframe's
 *    own DOM instead; see the file-level README for why).
 *  - `route.propose`: "Route hierhin" only ever raises the host's
 *    confirmation banner (W-10) -- this add-on cannot and does not activate
 *    a route itself.
 *
 * KNOWN PLATFORM GAP, worked around here (documented in
 * docs/addon-dev-guide.md §9 and this task's final report): the host's map
 * layer adapter (`apps/web/src/addons/mapLayers.ts`) renders
 * `map.addMarkers()`/`map.addLayer()` output as plain, NON-interactive
 * MapLibre circle layers -- there is no click-event channel back into an
 * add-on's iframe today, even though docs/05 §3's illustrative SDK snippet
 * sketches "addMarkers(...) // inkl. Klick-Callbacks". Rather than modifying
 * the host runtime (out of scope for this task, and the instructions are
 * explicit: adjust the EXAMPLE, don't extend the sandbox), this add-on ALSO
 * renders its own clickable POI list inside its own iframe DOM -- so
 * "click a POI -> detail view -> route.propose" is fully demonstrable with
 * the SDK surface that exists today. The real map layer is still pushed via
 * `map.addLayer`/`map.addMarkers` (so the shell's actual map keeps the visual
 * overlay), it just isn't the click TARGET.
 */

import { connectAddon } from '@yapaja/addon-sdk';
import campsitesGeoJson from '../data/campsites.geojson';
import { poisFromGeoJson } from './types.js';
import { distinctCategories, filterByCategory } from './filterPois.js';
import type { CampsiteGeoJson, CampsitePoi } from './types.js';

const ALL_POIS: CampsitePoi[] = poisFromGeoJson(campsitesGeoJson as unknown as CampsiteGeoJson);
const CATEGORIES = distinctCategories(ALL_POIS);

const MAP_LAYER_ID = 'campsites';
const MAP_SELECTED_LAYER_ID = 'campsites-selected';
const WIDGET_ID = 'poi-detail';

/** Minimal local stand-in for a GeoJSON `FeatureCollection` -- this project's
 *  tsc `lib` set doesn't include the global `GeoJSON` namespace (same reason
 *  `apps/web/src/addons/mapLayers.ts` avoids it), and `AddLayerParams.data`
 *  is typed `unknown` on the SDK side anyway (host-validated), so a precise
 *  shared type isn't needed here. */
interface PointFeatureCollection {
  type: 'FeatureCollection';
  features: Array<{
    type: 'Feature';
    geometry: { type: 'Point'; coordinates: [number, number] };
    properties: { id: string; name: string; category: string };
  }>;
}

function toFeatureCollection(pois: readonly CampsitePoi[]): PointFeatureCollection {
  return {
    type: 'FeatureCollection',
    features: pois.map((p) => ({
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [p.lng, p.lat] },
      properties: { id: p.id, name: p.name, category: p.category },
    })),
  };
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, attrs: Record<string, string> = {}): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'text') node.textContent = v;
    else node.setAttribute(k, v);
  }
  return node;
}

async function main(): Promise<void> {
  const addon = await connectAddon();

  const activeCategories = new Set(CATEGORIES.map((c) => c.id)); // all on by default
  let selected: CampsitePoi | null = null;

  const root = document.getElementById('app');
  if (!root) throw new Error('missing #app root');

  const settingsPanel = document.getElementById('poi-settings-panel') as HTMLDivElement;
  const listEl = document.getElementById('poi-list') as HTMLDivElement;
  const countEl = document.getElementById('poi-count') as HTMLSpanElement;
  const detailEl = document.getElementById('poi-detail') as HTMLDivElement;
  const settingsToggle = document.getElementById('poi-settings-toggle') as HTMLButtonElement;

  // --- settings panel: one checkbox per category (docs/05 §6.1) -----------
  for (const cat of CATEGORIES) {
    const row = el('label', { class: 'poi-category-row' });
    const checkbox = el('input', { type: 'checkbox', 'data-testid': `poi-category-${cat.id}` });
    checkbox.checked = true;
    checkbox.addEventListener('change', () => {
      if (checkbox.checked) activeCategories.add(cat.id);
      else activeCategories.delete(cat.id);
      renderList();
      pushMapLayer();
    });
    row.appendChild(checkbox);
    row.appendChild(el('span', { text: `${cat.label}` }));
    settingsPanel.appendChild(row);
  }

  settingsToggle.addEventListener('click', () => {
    settingsPanel.classList.toggle('open');
  });

  function pushMapLayer(): void {
    const visible = filterByCategory(ALL_POIS, activeCategories);
    void addon.map.addLayer({
      id: MAP_LAYER_ID,
      data: toFeatureCollection(visible),
      render: 'circle',
      paint: { 'circle-color': '#16a34a', 'circle-radius': 5, 'circle-stroke-width': 1, 'circle-stroke-color': '#ffffff' },
    });
  }

  function pushSelectedLayer(): void {
    if (!selected) {
      void addon.map.removeLayer({ id: MAP_SELECTED_LAYER_ID });
      return;
    }
    void addon.map.addLayer({
      id: MAP_SELECTED_LAYER_ID,
      data: toFeatureCollection([selected]),
      render: 'circle',
      paint: { 'circle-color': '#dc2626', 'circle-radius': 9, 'circle-stroke-width': 2, 'circle-stroke-color': '#ffffff' },
    });
  }

  function renderDetail(): void {
    detailEl.innerHTML = '';
    if (!selected) {
      detailEl.appendChild(el('p', { class: 'poi-detail-empty', text: 'Kein Stellplatz ausgewählt.' }));
      void addon.widgets.update(WIDGET_ID, { text: 'Kein Stellplatz ausgewählt' });
      return;
    }
    const poi = selected;
    detailEl.appendChild(el('h3', { text: poi.name }));
    detailEl.appendChild(el('p', { text: `${poi.categoryLabel} · ${poi.pricePerNightEur > 0 ? poi.pricePerNightEur.toFixed(2) + ' €/Nacht' : 'kostenlos'}` }));
    detailEl.appendChild(el('p', { text: poi.description }));
    if (poi.amenities.length > 0) {
      const list = el('ul', { class: 'poi-amenities' });
      for (const a of poi.amenities) list.appendChild(el('li', { text: a }));
      detailEl.appendChild(list);
    }
    const button = el('button', { 'data-testid': 'poi-route-button', text: `Route hierhin` });
    button.addEventListener('click', () => {
      void addon.route.propose({
        waypoints: [{ lat: poi.lat, lng: poi.lng }],
        reason: `Route zu ${poi.name}`,
      });
    });
    detailEl.appendChild(button);

    void addon.widgets.update(WIDGET_ID, { text: `${poi.name} (${poi.categoryLabel})` });
  }

  function renderList(): void {
    const visible = filterByCategory(ALL_POIS, activeCategories);
    countEl.textContent = String(visible.length);
    listEl.innerHTML = '';
    for (const poi of visible) {
      const item = el('button', {
        class: 'poi-list-item',
        'data-testid': `poi-item-${poi.id}`,
      });
      item.textContent = `${poi.name} · ${poi.categoryLabel}`;
      item.addEventListener('click', () => {
        selected = poi;
        renderDetail();
        pushSelectedLayer();
      });
      listEl.appendChild(item);
    }
  }

  // --- initial registration ------------------------------------------------
  await addon.widgets.register({
    widgetId: WIDGET_ID,
    name: 'Stellplatz-Detail',
    slots: ['side-panel'],
    data: { text: 'Kein Stellplatz ausgewählt' },
  });

  pushMapLayer();
  renderList();
  renderDetail();
}

void main();
