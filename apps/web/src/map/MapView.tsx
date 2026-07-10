import React, { useEffect, useRef, useState } from 'react';
import maplibregl from 'maplibre-gl';
import { Protocol } from 'pmtiles';
import 'maplibre-gl/dist/maplibre-gl.css';
import { mapController, useMapStore } from '../state/mapStore';
import { fetchRegions, pmtilesUrlForRegion, type MapRegionSummary } from './regions';
import { buildMinimalStyle } from './style';
import { useViewModeStore, syncHeadingToBearing } from './viewMode';
import { initializeFollowMe, updateFollowMePosition } from './followMe';
import { usePosition } from '../position/positionStore';
import CompassButton from './CompassButton';
import ViewModeButton from './ViewModeButton';
import ReCenterButton from './ReCenterButton';

// Register the `pmtiles://` protocol once per page load. MapLibre's protocol
// registry (`maplibregl.addProtocol`) is a process-global map keyed by
// scheme, so this must happen exactly once at module scope rather than per
// MapView mount (ADR-003: PMTiles).
const pmtilesProtocol = new Protocol();
maplibregl.addProtocol('pmtiles', pmtilesProtocol.tile);

declare global {
  interface Window {
    /**
     * Debug/E2E hook: exposes the MapController so Playwright can drive and
     * assert on the live map (`getMap().getZoom()`, `getCenter()`, …) via
     * `page.evaluate`. Read-only in intent — production code must still go
     * through `useMapStore`/`mapController`, never through this global.
     */
    __yapajaMapController?: typeof mapController;
  }
}

if (typeof window !== 'undefined') {
  window.__yapajaMapController = mapController;
}

type MapViewStatus = 'loading' | 'no-region' | 'ready';

/**
 * Renders the MapLibre base map (ADR-002) against a PMTiles region (ADR-003).
 *
 * This is a *minimal* style — a background layer plus the region's vector
 * source registered — replaced by the real core-served style system in
 * E01-T4. All source/tile URLs are relative (`import.meta.env.BASE_URL`),
 * so the app keeps working when served under an ingress sub-path (W-15).
 */
export default function MapView(): React.ReactElement {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const setMap = useMapStore((state) => state.setMap);
  const [status, setStatus] = useState<MapViewStatus>('loading');
  const [region, setRegion] = useState<MapRegionSummary | null>(null);
  const restoreViewMode = useViewModeStore((state) => state.restoreMode);
  const position = usePosition();
  // Reactively track the live Map instance from the store. All map-dependent
  // effects (view-mode restore, follow-me, bearing sync) depend on `[map]` so
  // they (re)attach their listeners as soon as the map is registered — never
  // silently aborting because the map wasn't ready at first mount.
  const map = useMapStore((state) => state.map);

  // Step 1: discover installed regions. No region installed -> friendly
  // empty state instead of initializing a map with a broken/missing source.
  useEffect(() => {
    let cancelled = false;
    void fetchRegions().then((regions) => {
      if (cancelled) {
        return;
      }
      if (regions.length === 0) {
        setStatus('no-region');
        return;
      }
      setRegion(regions[0]);
      setStatus('ready');
    });
    return () => {
      cancelled = true;
    };
  }, []);

  // Step 2: initialize the map once a region is known and the container is
  // mounted. `mapRef` guards against ever having two live Map instances at
  // once: the map is created here and torn down in the cleanup below, so
  // React 18 dev StrictMode's mount -> cleanup -> mount cycle still only
  // ever has at most one live instance.
  useEffect(() => {
    if (status !== 'ready' || !region || !containerRef.current) {
      return;
    }

    const newMap = new maplibregl.Map({
      container: containerRef.current,
      style: buildMinimalStyle(pmtilesUrlForRegion(region.region)),
      // Fits the initial viewport to the installed region's bounds so the
      // start viewport is plausible (never [0, 0]).
      bounds: region.bounds,
      attributionControl: { customAttribution: '© OpenStreetMap contributors' },
    });

    newMap.addControl(new maplibregl.NavigationControl());

    // Missing/dummy vector tiles (e.g. an empty fixture archive) must never
    // crash the app: log and keep the map interactive.
    newMap.on('error', (event) => {
      console.warn('[MapView] MapLibre error event', event.error);
    });

    mapRef.current = newMap;
    setMap(newMap);

    return () => {
      setMap(null);
      mapRef.current = null;
      newMap.remove();
    };
    // `setMap` is a stable zustand action reference and intentionally
    // omitted from the dependency array (no react-hooks/exhaustive-deps
    // lint rule is configured in this repo).
  }, [status, region]);

  // Restore persisted view mode once the map is registered. Depends on `[map]`
  // so the persisted mode is applied to the camera as soon as the map exists —
  // critical for reload-persistence.
  useEffect(() => {
    if (!map) {
      return;
    }
    restoreViewMode();
  }, [map, restoreViewMode]);

  // Initialize Follow-Me tracking once the map is registered. Self-cleaning:
  // the listeners are removed when the map is torn down or the component
  // unmounts (no double-listener leak).
  useEffect(() => {
    if (!map) {
      return;
    }
    const cleanup = initializeFollowMe();
    return cleanup;
  }, [map]);

  // Update Follow-Me position when position changes.
  useEffect(() => {
    if (!map || !position) {
      return;
    }
    updateFollowMePosition();
  }, [map, position]);

  // Sync heading to bearing for course modes + lock 2d-north bearing. Attaches
  // rotate/moveend listeners as soon as the map is registered so both the
  // heading-follow (course modes) and the bearing=0 lock (2d-north) react to
  // any rotation — including programmatic `setBearing`.
  useEffect(() => {
    if (!map) {
      return;
    }

    // Initial sync
    syncHeadingToBearing();

    // Listen to rotate and moveend events to re-sync
    const handleRotation = () => syncHeadingToBearing();
    map.on('rotate', handleRotation);
    map.on('moveend', handleRotation);

    return () => {
      map.off('rotate', handleRotation);
      map.off('moveend', handleRotation);
    };
  }, [map]);

  if (status === 'loading') {
    return <div className="w-full h-full" data-testid="map-loading" />;
  }

  if (status === 'no-region') {
    return (
      <div
        className="w-full h-full flex items-center justify-center bg-slate-100 dark:bg-slate-900"
        data-testid="map-no-region"
      >
        <div className="text-center p-6 max-w-sm">
          <p className="text-lg font-semibold text-slate-800 dark:text-slate-100">
            Keine Karte installiert
          </p>
          <p className="mt-2 text-sm text-slate-600 dark:text-slate-400">
            Für dieses Gerät ist noch keine Kartenregion heruntergeladen. Lade eine Region
            herunter, um die Karte anzuzeigen.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="w-full h-full relative">
      <div ref={containerRef} className="w-full h-full" data-testid="map-container" />
      {status === 'ready' && (
        <>
          <CompassButton />
          <ViewModeButton />
          <ReCenterButton />
        </>
      )}
    </div>
  );
}
