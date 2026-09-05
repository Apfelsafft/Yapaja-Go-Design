/**
 * Destination Selector (E03-T3): a headless component that wires up map
 * gestures for routing:
 *  - Click on the map drops a destination pin and opens the bottom sheet
 *    (`RoutingPanel`).
 *  - Tapping/clicking an already-displayed alternative route (the gray,
 *    tappable lines from `RouteLayer`) makes it the active route instead of
 *    picking a new destination -- handled here (not in `RouteLayer`, which
 *    only renders) so there is exactly one place deciding what a map click
 *    means, with no risk of two independent listeners both firing for the
 *    same click.
 *  - E03-T4: contextmenu (desktop right-click, and how MapLibre reports a
 *    touch long-press) on a RENDERED ROUTE (main or alternative) means
 *    "Diesen Abschnitt meiden": builds a small `exclude_polygon` around the
 *    clicked point and reroutes with it added to the session's temporary
 *    avoidances. A contextmenu/long-press that does NOT land on a rendered
 *    route falls back to the same behavior as a plain click (drop a new
 *    destination pin), preserving long-press-to-pick-destination for
 *    touch users away from any route.
 *
 * Follows the same map-ready reactive pattern as `PositionPuck`/`RouteLayer`
 * (`useMapStore((s) => s.map)`, `[map]` deps) -- attaching event listeners
 * doesn't need the style-load guard (that's only for `addSource`/`addLayer`),
 * but still must wait for the map instance to exist.
 */

import { useEffect } from 'react';
import type { Map as MapLibreMap, MapMouseEvent, PointLike } from 'maplibre-gl';
import { useMapStore } from '../state/mapStore.js';
import { useProfileStore } from '../profiles/store.js';
import { useRoutingStore } from './store.js';
import { useStyleStore } from '../state/styleStore.js';
import { resolvePlaceName } from '../map/placeName.js';
import { buildAvoidSquare } from './exclusionGeometry.js';
import { mapTapIntent, ROUTE_TAP_RADIUS_PX } from './mapTapIntent.js';
import { useNavStore } from '../drive/navStore.js';
import {
  ALT_ROUTE_LAYER_ID,
  MAIN_ROUTE_CASING_LAYER_ID,
  MAIN_ROUTE_ACCENT_LAYER_ID,
} from './layerIds.js';

const ROUTE_LAYER_IDS = [ALT_ROUTE_LAYER_ID, MAIN_ROUTE_CASING_LAYER_ID, MAIN_ROUTE_ACCENT_LAYER_ID];

/**
 * Ein Quadrat um den Tipper statt eines einzelnen Pixels.
 *
 * `queryRenderedFeatures(e.point)` trifft GENAU einen Bildpunkt. Eine
 * Fingerkuppe ist keinen Punkt breit -- gemeldet als „wenn ich hier nicht
 * genau treffe, bin ich wieder in der Zieleingabe" (und die berechneten
 * Alternativen waren weg). Siehe `ROUTE_TAP_RADIUS_PX`.
 */
function tapBox(e: MapMouseEvent): [PointLike, PointLike] {
  const r = ROUTE_TAP_RADIUS_PX;
  return [
    [e.point.x - r, e.point.y - r],
    [e.point.x + r, e.point.y + r],
  ];
}

function pickRouteIdAtPoint(map: MapLibreMap, e: MapMouseEvent): string | null {
  if (!map.getLayer(ALT_ROUTE_LAYER_ID)) {
    return null;
  }
  const hits = map.queryRenderedFeatures(tapBox(e), { layers: [ALT_ROUTE_LAYER_ID] });
  const routeId = hits[0]?.properties?.routeId;
  return typeof routeId === 'string' ? routeId : null;
}

/** Whether `e` landed on ANY currently-rendered route line (main or alternative). */
function isOnRenderedRoute(map: MapLibreMap, e: MapMouseEvent): boolean {
  const layers = ROUTE_LAYER_IDS.filter((id) => map.getLayer(id));
  if (layers.length === 0) return false;
  return map.queryRenderedFeatures(tapBox(e), { layers }).length > 0;
}

export default function DestinationSelector(): null {
  const map = useMapStore((state) => state.map);
  const setDestination = useRoutingStore((state) => state.setDestination);
  const selectRoute = useRoutingStore((state) => state.selectRoute);
  const addSectionAvoidance = useRoutingStore((state) => state.addSectionAvoidance);
  const setStartPoint = useRoutingStore((state) => state.setStartPoint);
  const setPickTarget = useRoutingStore((state) => state.setPickTarget);
  const activeProfile = useProfileStore((state) => state.activeProfile);

  useEffect(() => {
    if (!map) return;

    const handlePick = (e: MapMouseEvent): void => {
      // `contextmenu`'s browser default (desktop right-click menu) must
      // never appear over the map.
      e.originalEvent?.preventDefault?.();

      // Was dieser Tipper bedeutet, entscheidet EINE reine Funktion --
      // siehe `mapTapIntent.ts` fuer die beiden Fehler, die diese Trennung
      // ausgeloest haben.
      //
      // Die Zustaende werden ueber `getState()` gelesen, nicht ueber Hooks:
      // dieser Effekt haengt bewusst nur an `map`, damit die Kartenlistener
      // nicht bei jeder Zustandsaenderung ab- und wieder angemeldet werden.
      // Ein Hook-Wert waere in diesem Closure eingefroren.
      const intent = mapTapIntent({
        tappedRouteId: pickRouteIdAtPoint(map, e),
        pickTarget: useRoutingStore.getState().pickTarget,
        navStatus: useNavStore.getState().navState?.status,
      });

      if (intent.kind === 'select-route') {
        selectRoute(intent.routeId);
        return;
      }

      // Waehrend einer laufenden Fahrt bewirkt ein Tipper neben die Route
      // NICHTS. Vorher ersetzte er die Route stillschweigend durch einen
      // Zielpunkt -- auch bei einem verrutschten Schwenk.
      if (intent.kind === 'ignore') {
        return;
      }

      const point = { lat: e.lngLat.lat, lon: e.lngLat.lng };

      // ─── ZWISCHENZIEL ──────────────────────────────────────────────────
      // Gilt AUCH waehrend der Fahrt (siehe `mapTapIntent.ts`): in diesen
      // Modus kommt man nur ueber einen eigenen Knopf, das Antippen ist
      // also bereits die zweite bewusste Handlung.
      //
      // Der Modus faellt danach sofort zurueck -- aus derselben Ueberlegung
      // wie beim Startpunkt: ein Zustand, in dem jeder weitere Tipper still
      // eine Station anhaengt, waere aus der Karte heraus nicht erkennbar.
      if (intent.kind === 'set-waypoint') {
        const wpLang = useStyleStore.getState().options.lang;
        useRoutingStore.getState().addWaypoint(
          point,
          resolvePlaceName({
            map,
            point,
            preferredLang: wpLang === 'name' ? undefined : wpLang,
          }),
          // Nur neu berechnen, wenn ueberhaupt schon ein Ziel steht.
          useRoutingStore.getState().destination
            ? { origin: 'current', profileId: useProfileStore.getState().activeProfile?.id }
            : null,
        );
        setPickTarget('destination');
        return;
      }

      // Ist der Startpunkt-Modus aktiv, meint dieser Klick den START.
      // Danach faellt der Modus sofort zurueck: ein Zustand, in dem jeder
      // weitere Klick still den Start verschiebt, statt ein Ziel zu setzen,
      // waere aus der Karte heraus nicht erkennbar.
      if (intent.kind === 'set-origin') {
        const startLang = useStyleStore.getState().options.lang;
        setStartPoint(
          point,
          resolvePlaceName({
            map,
            point,
            preferredLang: startLang === 'name' ? undefined : startLang,
          }),
        );
        setPickTarget('destination');
        return;
      }

      // Namen aus den bereits geladenen Vektorkacheln holen (placeName.ts).
      // Ohne das stand im Panel nur „Ziel" und zwei Zahlen — die Wahrheit,
      // aber keine Auskunft darüber, wohin die Fahrt geht. Findet sich kein
      // Name nah genug, bleibt es bei den Koordinaten; ein erfundener Name
      // wäre schlimmer, weil man ihm glauben würde.
      const lang = useStyleStore.getState().options.lang;
      setDestination(
        point,
        resolvePlaceName({ map, point, preferredLang: lang === 'name' ? undefined : lang }),
      );
    };

    const handleContextMenu = (e: MapMouseEvent): void => {
      e.originalEvent?.preventDefault?.();

      if (isOnRenderedRoute(map, e)) {
        const center = { lat: e.lngLat.lat, lon: e.lngLat.lng };
        addSectionAvoidance(buildAvoidSquare(center), {
          origin: 'current',
          profileId: activeProfile?.id,
        });
        return;
      }

      handlePick(e);
    };

    map.on('click', handlePick);
    map.on('contextmenu', handleContextMenu);

    return () => {
      map.off('click', handlePick);
      map.off('contextmenu', handleContextMenu);
    };
  }, [map, setDestination, selectRoute, addSectionAvoidance, activeProfile]);

  return null;
}
