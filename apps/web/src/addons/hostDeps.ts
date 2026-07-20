/**
 * Builds the REAL `HostBridgeDeps` wired to the running web app (E09-T2). This
 * is the trusted glue between the scope-checked bridge and the app's map,
 * widget registry, position/nav stores, Core storage API, and the route-
 * proposal banner. Kept as a single module-level singleton so every add-on
 * bridge shares the same map/widget adapters (namespacing keeps them isolated).
 *
 * Everything here runs on the HOST side of the sandbox and is only ever
 * reached AFTER the bridge has verified source + scope -- these adapters
 * perform the namespacing/side effects, never the authorization.
 */

import React from 'react';
import type { Widget } from '@yapaja/ui';
import type { Position } from '@yapaja/shared';
import type { HostBridgeDeps } from './bridge.js';
import { usePositionStore } from '../position/positionStore.js';
import { useNavStore } from '../drive/navStore.js';
import { shellWidgetRegistry } from '../shell/widgets/registry.js';
import { addonMapLayers } from './mapLayers.js';
import { useAddonWidgetStore, namespacedWidgetId } from './addonWidgetStore.js';
import { useRouteProposalStore, nextProposalId } from './routeProposalStore.js';
import { publishAddonEvent } from './addonEvents.js';
import { getAddonStorage, setAddonStorage } from './client.js';
import AddonWidgetView from './AddonWidgetView.js';

function toPositionUpdate(pos: Position): { lat: number; lng: number; speed: number | null; heading: number | null } {
  return { lat: pos.lat, lng: pos.lon, speed: pos.speed, heading: pos.heading };
}

/** Registers a stub Widget into the shell registry for an add-on widget, so it
 *  ALSO shows up in the widget library like a core widget. Defensive against a
 *  duplicate id (StrictMode remount / re-enable). */
function registerShellWidget(id: string, name: string): void {
  if (shellWidgetRegistry.has(id)) return;
  const widget: Widget = {
    id,
    name,
    sizes: ['S', 'M', 'L'],
    topics: [],
    render: () => React.createElement(AddonWidgetView, { id }),
  };
  shellWidgetRegistry.register(widget);
}

export function buildHostBridgeDeps(): HostBridgeDeps {
  const mapLayers = addonMapLayers;

  return {
    position: {
      subscribe(cb) {
        // Emit the current fix immediately so a late subscriber isn't blank.
        const current = usePositionStore.getState().position;
        if (current) cb(toPositionUpdate(current));
        return usePositionStore.subscribe((state) => {
          if (state.position) cb(toPositionUpdate(state.position));
        });
      },
    },
    nav: {
      getState: () => useNavStore.getState().navState,
    },
    map: {
      addLayer: (addonId, params) => mapLayers.addLayer(addonId, params),
      addMarkers: (addonId, params) => mapLayers.addMarkers(addonId, params),
      removeLayer: (addonId, layerId) => mapLayers.removeLayer(addonId, layerId),
      removeAllForAddon: (addonId) => mapLayers.removeAllForAddon(addonId),
    },
    widgets: {
      register: (addonId, params) => {
        const id = namespacedWidgetId(addonId, params.widgetId);
        useAddonWidgetStore.getState().register({
          addonId,
          id,
          widgetId: params.widgetId,
          name: params.name,
          slots: params.slots,
          data: params.data ?? {},
        });
        registerShellWidget(id, params.name);
      },
      update: (addonId, params) => {
        useAddonWidgetStore.getState().update(namespacedWidgetId(addonId, params.widgetId), params.data);
      },
      removeAllForAddon: (addonId) => {
        // Unregister each of this add-on's shell-registry stubs before dropping
        // them from the runtime store -- residue-free teardown on disable.
        for (const entry of Object.values(useAddonWidgetStore.getState().widgets)) {
          if (entry.addonId === addonId) shellWidgetRegistry.unregister(entry.id);
        }
        useAddonWidgetStore.getState().removeAllForAddon(addonId);
      },
    },
    events: {
      publish: (topic, payload) => publishAddonEvent(topic, payload),
    },
    storage: {
      get: (addonId, key) => getAddonStorage(addonId, key),
      set: (addonId, key, value) => setAddonStorage(addonId, key, value),
    },
    routes: {
      propose: (addonId, params) =>
        useRouteProposalStore.getState().add({
          id: nextProposalId(),
          addonId,
          waypoints: params.waypoints,
          reason: params.reason,
        }),
      clearForAddon: (addonId) => useRouteProposalStore.getState().clearForAddon(addonId),
    },
    logger: {
      warn: (message, meta) => console.warn(message, meta ?? {}),
    },
  };
}
