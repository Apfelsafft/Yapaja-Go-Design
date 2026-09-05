import React, { useEffect, useRef, useState } from 'react';
import maplibregl from 'maplibre-gl';
import type { StyleSpecification } from 'maplibre-gl';
import { Protocol } from 'pmtiles';
import 'maplibre-gl/dist/maplibre-gl.css';
import { mapController, useMapStore } from '../state/mapStore';
import { fetchRegions, type MapRegionSummary } from './regions';
import {
  fetchStyle,
  buildFallbackStyle,
  applyDegradationCaps,
  type StyleOptions,
} from './styleClient';
import { applyStyle, trackCoreStyle } from './styleSwitch';
import { useStyleStore } from '../state/styleStore';
import { useDegradationStore } from '../perf/degrade';
import { useViewModeStore, syncHeadingToBearing } from './viewMode';
import { initializeFollowMe, updateFollowMePosition } from './followMe';
import { usePosition, usePositionStore } from '../position/positionStore';
import { pickActiveRegion } from './activeRegion';
import { useRegionStore } from './regionStore';
import RegionCoverageNotice from './RegionCoverageNotice';
import CompassButton from './CompassButton';
import ViewModeButton from './ViewModeButton';
import ReCenterButton from './ReCenterButton';
import StylePanel from './StylePanel';
import RegionsPanel from '../settings/regions/RegionsPanel';
import StorePanel from '../store/StorePanel';
import PreflightPanel from '../settings/preflight/PreflightPanel';
import PerfOverlay from '../perf/PerfOverlay';
import { startPerfWatchdog } from '../perf/perfWatchdog';
import SimulatorPanel from '../simulator/SimulatorPanel.js';

/** Identifies which (styleId, options, region) combination is currently
 *  applied to the live map, so the live-switch effect can tell "this is the
 *  style we just initialized with" apart from "something new is needed".
 *
 *  Die REGION gehoert mit in diesen Schluessel. Ohne sie war ein Wechsel der
 *  Region fuer diesen Vergleich unsichtbar: der Stil-Tausch wurde als
 *  „schon angewendet" uebersprungen, und die Karte behielt den alten
 *  Kachelsatz — also genau die leere Flaeche, die behoben werden soll. */
function styleKey(styleId: string, options: StyleOptions, region: string | null): string {
  return `${styleId}|${options.lang}|${options.labelScale}|${options.poi}|${region ?? ''}`;
}

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

interface InitialStyle {
  style: StyleSpecification;
  key: string;
}

/**
 * Renders the MapLibre base map (ADR-002) against a PMTiles region (ADR-003),
 * styled by the core-served style system (E01-T4: `GET
 * /api/v1/map/styles/:id`, light/dark/contrast + lang/labelScale/poi
 * options). All source/tile/style URLs are relative
 * (`import.meta.env.BASE_URL`), so the app keeps working when served under
 * an ingress sub-path (W-15).
 */
export interface MapViewProps {
  /**
   * Bedienelemente anzeigen (Kompass, Ansicht, Zurueck-zur-Position,
   * Einstellungen, Regionen, Store, Installationspruefung).
   *
   * `false` fuer die Einbettung in ein Home-Assistant-Dashboard: dort soll die
   * Karte etwas ZEIGEN und nicht bedient werden -- Knoepfe in einer
   * Dashboard-Kachel, die die Navigation des Fahrzeugs umstellen, waeren dort
   * eine Falle. Vorgabe `true`, damit sich fuer die App selbst nichts aendert.
   */
  chrome?: boolean;
}

export default function MapView({ chrome = true }: MapViewProps = {}): React.ReactElement {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const setMap = useMapStore((state) => state.setMap);
  const [status, setStatus] = useState<MapViewStatus>('loading');
  // NUR die Region, mit der die Karte ERZEUGT wurde (fuer `bounds`). Sie wird
  // nach dem ersten Setzen nie wieder veraendert — sie steckt in den
  // Abhaengigkeiten von Schritt 2, und ein Wechsel dort wuerde die Karte
  // zerstoeren und neu bauen. Ein Regionswechsel im Betrieb laeuft
  // stattdessen ueber den Stil-Tausch in Schritt 3, der die Kamera behaelt.
  const [initialRegion, setInitialRegion] = useState<MapRegionSummary | null>(null);
  const [initialStyle, setInitialStyle] = useState<InitialStyle | null>(null);
  const installedRegions = useRegionStore((state) => state.regions);
  const manualRegion = useRegionStore((state) => state.manual);
  const setInstalledRegions = useRegionStore((state) => state.setRegions);
  const restoreViewMode = useViewModeStore((state) => state.restoreMode);
  const position = usePosition();
  const styleId = useStyleStore((state) => state.styleId);
  const userStyleOptions = useStyleStore((state) => state.options);
  // Transient performance-degradation caps (E01-T6). These clamp the effective
  // render options DOWN from the user's persisted choice under low FPS; they
  // are never persisted and never overwrite `userStyleOptions` (that would
  // destroy the user's explicit style preference — the bug this replaced).
  const poiCap = useDegradationStore((state) => state.poiCap);
  const labelScaleCap = useDegradationStore((state) => state.labelScaleCap);
  const styleOptions = applyDegradationCaps(userStyleOptions, {
    poi: poiCap,
    labelScale: labelScaleCap,
  });
  // Tracks the (styleId, options, region) combination already applied to the
  // live map, so the live-switch effect below can skip the redundant re-fetch
  // right after mount (the map was just initialized with exactly this style).
  const appliedStyleKeyRef = useRef<string | null>(null);

  // ─── WELCHE REGION GERADE GILT ────────────────────────────────────────────
  // Wird bei jedem Rendern neu bestimmt, damit eine neue Position (oder eine
  // Wahl im Kartenmenue) sofort zaehlt. Nur der NAME geht in die
  // Abhaengigkeiten des Stil-Effekts: `pickActiveRegion` liefert bei jedem
  // Aufruf ein neues Objekt, ein Objektvergleich wuerde also bei jedem
  // Positions-Tick einen Stil-Neuaufbau ausloesen.
  const activeChoice = pickActiveRegion({
    regions: installedRegions,
    point: position,
    manual: manualRegion,
  });
  const activeRegionName = activeChoice.region?.region ?? null;
  // Reactively track the live Map instance from the store. All map-dependent
  // effects (view-mode restore, follow-me, bearing sync) depend on `[map]` so
  // they (re)attach their listeners as soon as the map is registered — never
  // silently aborting because the map wasn't ready at first mount.
  const map = useMapStore((state) => state.map);

  // Step 1: discover installed regions, then fetch the initial style JSON
  // (the persisted/default styleId+options at the time of this mount). No
  // region installed -> friendly empty state instead of initializing a map
  // with a broken/missing source; the style fetch never blocks that check.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const regions = await fetchRegions();
      if (cancelled) {
        return;
      }
      if (regions.length === 0) {
        setStatus('no-region');
        return;
      }
      setInstalledRegions(regions);

      // Schon beim ersten Stil die Region benennen, statt sie dem Core zu
      // ueberlassen: liegt eine Position vor (etwa aus einer HA-Entitaet, die
      // sofort da ist), soll die Karte gar nicht erst mit der falschen Region
      // aufgehen und dann umschalten.
      const initialChoice = pickActiveRegion({
        regions,
        point: usePositionStore.getState().position,
        manual: useRegionStore.getState().manual,
      });
      const initialRegion = initialChoice.region ?? regions[0];
      setInitialRegion(initialRegion);

      const { styleId: initialStyleId, options: userOptions } = useStyleStore.getState();
      const { poiCap: initialPoiCap, labelScaleCap: initialLabelScaleCap } =
        useDegradationStore.getState();
      const initialOptions = applyDegradationCaps(userOptions, {
        poi: initialPoiCap,
        labelScale: initialLabelScaleCap,
      });
      const fetched = await fetchStyle(initialStyleId, initialOptions, initialRegion.region);
      if (cancelled) {
        return;
      }
      setInitialStyle({
        style: fetched ?? buildFallbackStyle(),
        key: styleKey(initialStyleId, initialOptions, initialRegion.region),
      });
      setStatus('ready');
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Step 2: initialize the map once a region + initial style are known and
  // the container is mounted. `mapRef` guards against ever having two live
  // Map instances at once: the map is created here and torn down in the
  // cleanup below, so React 18 dev StrictMode's mount -> cleanup -> mount
  // cycle still only ever has at most one live instance.
  useEffect(() => {
    if (status !== 'ready' || !initialRegion || !initialStyle || !containerRef.current) {
      return;
    }

    const newMap = new maplibregl.Map({
      container: containerRef.current,
      style: initialStyle.style,
      // Fits the initial viewport to the installed region's bounds so the
      // start viewport is plausible (never [0, 0]).
      bounds: initialRegion.bounds,
      attributionControl: { customAttribution: '© OpenStreetMap contributors' },
      // Enables reading back rendered pixels (gl.readPixels) after a frame
      // for pixel-sample assertions (E01-T4 e2e: dark vs light background).
      // Negligible cost for a background-canvas map; standard practice for
      // WebGL content that needs to be inspected/tested from outside.
      canvasContextAttributes: { preserveDrawingBuffer: true },
    });

    newMap.addControl(new maplibregl.NavigationControl());

    // Missing/dummy vector tiles (e.g. an empty fixture archive) must never
    // crash the app: log and keep the map interactive.
    newMap.on('error', (event) => {
      console.warn('[MapView] MapLibre error event', event.error);
    });

    trackCoreStyle(initialStyle.style);
    appliedStyleKeyRef.current = initialStyle.key;

    mapRef.current = newMap;
    setMap(newMap);

    return () => {
      setMap(null);
      mapRef.current = null;
      appliedStyleKeyRef.current = null;
      newMap.remove();
    };
    // `setMap` is a stable zustand action reference and intentionally
    // omitted from the dependency array (no react-hooks/exhaustive-deps
    // lint rule is configured in this repo).
  }, [status, initialRegion, initialStyle]);

  // Step 3: live style switching. Whenever the effective styleId/options
  // change to something other than what's currently applied, fetch the new
  // style and swap it in place (camera + custom layers preserved — see
  // styleSwitch.ts) instead of recreating the Map. "Effective" options fold in
  // the user's choice AND any active performance-degradation cap, so recovering
  // FPS (cap lifted) re-applies the user's full-quality style automatically.
  // Deps are the primitive effective fields (not the `styleOptions` object,
  // which `applyDegradationCaps` rebuilds every render) so this fires only on a
  // real change.
  //
  // Seit 2026-09-03 loest das AUCH einen Regionswechsel aus (die Region ist
  // Teil von `styleKey`). Bewusst hier und nicht in Schritt 2: ein
  // Stil-Tausch behaelt Kamera und eigene Layer, ein Neuaufbau der Karte
  // wuerde beides verlieren — waehrend der Fahrt ueber eine Regionsgrenze
  // waere das ein Sprung mitten in der Navigation.
  useEffect(() => {
    if (!map) {
      return;
    }
    const key = styleKey(styleId, styleOptions, activeRegionName);
    if (appliedStyleKeyRef.current === key) {
      return;
    }
    let cancelled = false;
    void fetchStyle(styleId, styleOptions, activeRegionName ?? undefined).then((style) => {
      if (cancelled) {
        return;
      }
      applyStyle(map, style ?? buildFallbackStyle());
      appliedStyleKeyRef.current = key;
    });
    return () => {
      cancelled = true;
    };
  }, [
    map,
    styleId,
    styleOptions.poi,
    styleOptions.labelScale,
    styleOptions.lang,
    activeRegionName,
  ]);

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

  // Start performance watchdog (FPS meter + auto-degradation) once the map
  // is registered. Depends on `[map]` so it (re)attaches as soon as the map
  // is available — critical for proper FPS tracking.
  useEffect(() => {
    if (!map) {
      return;
    }
    const cleanup = startPerfWatchdog(map);
    return cleanup;
  }, [map]);

  if (status === 'loading') {
    return <div className="w-full h-full" data-testid="map-loading" />;
  }

  if (status === 'no-region') {
    return (
      <div
        className="w-full h-full relative flex items-center justify-center bg-slate-100 dark:bg-slate-900"
        data-testid="map-no-region"
      >
        <div className="text-center p-6 max-w-sm">
          <p className="text-lg font-semibold text-slate-800 dark:text-slate-100">
            Keine Karte installiert
          </p>
          {/* Vorher stand hier „Lade eine Region herunter". Das war eine
              Anweisung, die nicht ausführbar war: die mitgelieferten
              Katalogeinträge haben keine fertige Datei zum Herunterladen,
              die Kacheln werden gebaut (siehe
              `apps/core/src/map/regions/catalog.ts`). */}
          <p className="mt-2 text-sm text-slate-600 dark:text-slate-400">
            Für dieses Gerät sind noch keine Kartenkacheln vorhanden. Öffne „Installation
            prüfen" (🩺) — dort steht, was genau fehlt und was dagegen zu tun ist.
          </p>
        </div>
        {/* E01-T5: reachable even with no map installed yet -- this is
            exactly the state where downloading a first region matters most. */}
        <RegionsPanel />
        {/* E09-T7: the add-on Store is independent of any map region being
            installed -- reachable here too. */}
        <StorePanel />
        {/* Genau der Zustand, für den die Installationsprüfung existiert --
            hier muss sie erreichbar sein, nicht nur auf einer laufenden
            Karte. */}
        <PreflightPanel />
      </div>
    );
  }

  return (
    <div className="w-full h-full relative">
      <div ref={containerRef} className="w-full h-full" data-testid="map-container" />
      {status === 'ready' && chrome && (
        <>
          <CompassButton />
          <ViewModeButton />
          <ReCenterButton />
          <StylePanel />
          <RegionsPanel />
          <StorePanel />
          <PreflightPanel />
          {/* Nur auf der laufenden Karte: der Testfahrer faehrt eine geplante
              Route ab, und ohne Karte gibt es keine. Der Knopf erscheint
              ausserdem nur, wenn der Simulator ueberhaupt freigeschaltet ist
              (siehe SimulatorPanel). */}
          <SimulatorPanel />
          <PerfOverlay />
          <RegionCoverageNotice />
        </>
      )}
    </div>
  );
}
