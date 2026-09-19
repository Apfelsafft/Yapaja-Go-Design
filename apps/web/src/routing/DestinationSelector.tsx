/**
 * Destination Selector (E03-T3): a headless component that wires up map
 * gestures for routing:
 *  - LANGER DRUCK auf die Karte setzt einen Zielpunkt und oeffnet das
 *    Bodenblatt (`RoutingPanel`). Ein kurzer Tipper tut das seit 0.17.1
 *    NICHT mehr -- gemeldet: „Oftmals passiert das wenn man auf der Karte
 *    sucht, dass ein neues Ziel gewaehlt wird." Siehe `mapTapIntent.ts`
 *    (die Regel) und `langerDruck.ts` (die Messung).
 *  - Ein kurzer Tipper waehlt weiterhin eine Alternative aus und bestaetigt
 *    weiterhin Start- und Zwischenziel, wenn deren Modus aktiv ist: das sind
 *    Tipper auf etwas Sichtbares bzw. die zweite Handlung nach einem Knopf.
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
 *    avoidances. Ein langer Druck NEBEN jede gezeichnete Route setzt das
 *    Ziel -- das ist seit 0.17.1 der einzige Weg dorthin.
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
import { mapTapIntent, ROUTE_TAP_RADIUS_PX, type Geste } from './mapTapIntent.js';
import { langerDruckUeberwachen } from './langerDruck.js';
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

    const handlePick = (e: MapMouseEvent, geste: Geste = 'tipp'): void => {
      // `contextmenu`'s browser default (desktop right-click menu) must
      // never appear over the map.
      e.originalEvent?.preventDefault?.();

      // Was dieser Tipper bedeutet, entscheidet EINE reine Funktion --
      // siehe `mapTapIntent.ts` fuer die drei Fehler, die diese Trennung
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
        geste,
      });

      if (intent.kind === 'select-route') {
        selectRoute(intent.routeId);
        return;
      }

      if (intent.kind === 'ignore') {
        // ─── EIN VERWORFENER TIPPER SAGT, WARUM ──────────────────────────
        // Waehrend der Fahrt bewirkt ein Tipper neben die Route nichts --
        // dort ist Stille richtig, ein Hinweis ueber der Karte waere im
        // Fahrzeug gefaehrlicher als der ignorierte Tipper.
        //
        // Ausserhalb der Fahrt ist Stille das Gegenteil von richtig: wer
        // bisher getippt hat, um ein Ziel zu setzen, bekaeme ab jetzt
        // ueberhaupt keine Antwort und muesste selbst darauf kommen, es
        // laenger zu versuchen. Genau diese Sorte unerreichbarer Antwort
        // zieht sich durch die halbe Fehlergeschichte dieses Projekts.
        if (intent.reason === 'nur-langer-druck') {
          useRoutingStore.getState().zeigeLangerDruckHinweis();
        }
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

    // ─── ZWEI MELDER, EINE HANDLUNG ────────────────────────────────────────
    // Der lange Druck kommt auf zwei Wegen herein: als `contextmenu` vom
    // Browser (Rechtsklick am Schreibtisch, auf vielen Geraeten auch der
    // Fingerdruck) und aus der eigenen Messung in `langerDruck.ts`. Welcher
    // zuerst kommt, ist geraeteabhaengig -- also gewinnt schlicht der erste,
    // und der zweite faellt in dieses Fenster.
    //
    // Ohne das setzte ein Fingerdruck auf Geraeten, die BEIDES melden, das
    // Ziel zweimal und rechnete die Route zweimal.
    let zuletztLangMs = 0;
    const ENTPRELLUNG_MS = 900;
    const istWiederholung = (): boolean => {
      const jetzt = Date.now();
      if (jetzt - zuletztLangMs < ENTPRELLUNG_MS) return true;
      zuletztLangMs = jetzt;
      return false;
    };

    const handleContextMenu = (e: MapMouseEvent): void => {
      e.originalEvent?.preventDefault?.();

      if (isOnRenderedRoute(map, e)) {
        // Der Abschnitt-meiden-Weg bleibt unangetastet und zaehlt NICHT als
        // langer Druck: er setzt kein Ziel, es gibt also nichts zu entprellen.
        const center = { lat: e.lngLat.lat, lon: e.lngLat.lng };
        addSectionAvoidance(buildAvoidSquare(center), {
          origin: 'current',
          profileId: activeProfile?.id,
        });
        return;
      }

      if (istWiederholung()) return;
      handlePick(e, 'lang');
    };

    const abmelden = langerDruckUeberwachen(map, (ort) => {
      if (istWiederholung()) return;
      // Der eigene Melder liefert kein Browser-Ereignis. `handlePick` braucht
      // davon nur `lngLat` und `point`; `originalEvent` fehlt, und der
      // optionale Aufruf darauf faengt das ab.
      handlePick(ort as unknown as MapMouseEvent, 'lang');
    });

    map.on('click', handlePick);
    map.on('contextmenu', handleContextMenu);

    return () => {
      abmelden();
      map.off('click', handlePick);
      map.off('contextmenu', handleContextMenu);
    };
  }, [map, setDestination, selectRoute, addSectionAvoidance, activeProfile]);

  return null;
}
