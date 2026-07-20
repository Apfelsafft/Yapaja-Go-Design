/**
 * Top-level FRONTEND runtime for UI add-ons (E09-T2, docs/05 §1A, Wargame
 * W-10). Mounted once in `App.tsx`. Responsibilities:
 *
 *  - Discover ENABLED add-ons that ship a UI (`GET /api/v1/addons`), and
 *    reconcile on an interval (plus an imperative refresh hook) so an
 *    enable/disable takes effect without a full reload.
 *  - Render each as a `<iframe sandbox="allow-scripts">` (CRITICALLY, NO
 *    `allow-same-origin`: the add-on runs in an opaque origin and cannot touch
 *    the parent DOM, cookies, or localStorage) pointed at `/addons/{id}/ui/…`.
 *  - Wire each iframe to an `AddonBridge` (source-pinned, scope-checked). On
 *    disable/unmount the bridge is destroyed, which removes its map layers,
 *    widgets and route proposals immediately -- no residue.
 *  - Render the add-on widget slot layer + the route-proposal confirmation
 *    banner.
 */

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { AddonBridge, type HostBridgeDeps } from './bridge.js';
import { buildHostBridgeDeps } from './hostDeps.js';
import { fetchAddons, enabledUiAddons, addonUiSrc, type InstalledAddon } from './client.js';
import type { AddonScope } from '@yapaja/addon-sdk';
import AddonWidgetLayer from './AddonWidgetLayer.js';
import AddonRouteProposalBanner from './AddonRouteProposalBanner.js';
import { addonMapLayers } from './mapLayers.js';
import { useMapStore } from '../state/mapStore.js';

const REFRESH_INTERVAL_MS = 2000;

interface AddonFrameProps {
  addon: InstalledAddon;
  deps: HostBridgeDeps;
}

/** One sandboxed add-on iframe + its bridge. The bridge is created on mount
 *  (the iframe element already exists in the DOM, so `contentWindow` is live)
 *  and torn down on unmount -- which is exactly what fires when the add-on is
 *  disabled and drops out of `AddonHost`'s reconciled list. */
function AddonFrame({ addon, deps }: AddonFrameProps): React.ReactElement {
  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  const entry = addon.manifest.ui?.entry ?? 'ui/index.html';
  const src = addonUiSrc(addon.id, entry);

  useEffect(() => {
    const iframe = iframeRef.current;
    if (!iframe) return;
    const bridge = new AddonBridge({
      addonId: addon.id,
      // The granted scope-set IS the manifest's declared permissions (the
      // operator confirmed them at install time, E09-T1). `net.fetch:*` etc.
      // are simply never required by any UI bridge method.
      scopes: addon.manifest.permissions as AddonScope[],
      iframe,
      deps,
    });
    bridge.start();
    return () => bridge.destroy();
    // Re-create the bridge only if the add-on identity/scopes change.
  }, [addon.id, addon.manifest.permissions, deps]);

  return (
    <iframe
      ref={iframeRef}
      data-testid={`addon-frame-${addon.id}`}
      title={`${addon.name} (Add-on)`}
      // SECURITY: allow-scripts ONLY. NO allow-same-origin -> opaque origin ->
      // no parent DOM / cookie / storage access. The Core's CSP
      // (`connect-src 'none'`, no external hosts) closes the network side.
      sandbox="allow-scripts"
      src={src}
      className="h-40 w-64 rounded border border-slate-700 bg-slate-950/90 shadow-lg"
    />
  );
}

export default function AddonHost(): React.ReactElement {
  const [addons, setAddons] = useState<InstalledAddon[]>([]);
  const deps = useMemo(() => buildHostBridgeDeps(), []);

  // Re-apply every add-on's map layers whenever the live MapLibre instance
  // appears or is replaced (a style switch rebuilds the GL layers, dropping
  // add-on sources/layers) -- see `mapLayers.ts#reapplyAll`. A layer an add-on
  // added before the map was ready thus still shows up once it is; `reapplyAll`
  // is a no-op while the map is null.
  const map = useMapStore((state) => state.map);
  useEffect(() => {
    if (map) addonMapLayers.reapplyAll();
  }, [map]);

  useEffect(() => {
    let cancelled = false;
    const refresh = async (): Promise<void> => {
      try {
        const all = await fetchAddons();
        if (!cancelled) setAddons(enabledUiAddons(all));
      } catch {
        /* transient fetch failure -> keep the current set until next tick */
      }
    };
    void refresh();
    const timer = window.setInterval(() => void refresh(), REFRESH_INTERVAL_MS);
    // Imperative refresh hook so an e2e (or the settings UI) can force an
    // immediate reconcile after toggling an add-on, without waiting for the poll.
    window.__yapajaRefreshAddons = refresh;
    return () => {
      cancelled = true;
      window.clearInterval(timer);
      delete window.__yapajaRefreshAddons;
    };
  }, []);

  return (
    <>
      {/* The sandboxed add-on UI iframes, tucked bottom-left. Nothing renders
          when no enabled UI add-on is installed (zero impact on the app). */}
      <div data-testid="addon-frames" className="absolute bottom-2 left-2 z-30 flex flex-col gap-2">
        {addons.map((addon) => (
          <AddonFrame key={addon.id} addon={addon} deps={deps} />
        ))}
      </div>
      <AddonWidgetLayer />
      <AddonRouteProposalBanner />
    </>
  );
}

declare global {
  interface Window {
    /** E2E/imperative hook to force an immediate add-on reconcile. */
    __yapajaRefreshAddons?: () => Promise<void>;
  }
}
