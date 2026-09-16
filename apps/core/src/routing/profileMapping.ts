/**
 * 🔴 W-08 SAFETY CORE: map a `VehicleProfile` onto Valhalla `costing: "truck"`
 * options and build the full `/route` request body.
 *
 * Every field here decides which physical edges a truck route may use. A wrong
 * value means a route under too low a bridge or over too weak a road. The
 * mapping is therefore 1:1 and unit-checked, and each field is proven by the
 * profile-mapping intercept test.
 *
 * Unit alignment (all verified against the Valhalla truck-costing reference):
 *  - Valhalla `height`/`width`/`length` are in METRES; profile is in metres.  ✓
 *  - Valhalla `weight` is in metric TONNES; profile `weight_t` is in tonnes.   ✓
 *  - `top_speed` wird BEWUSST NICHT gesetzt. Die Einheit haette gepasst, die
 *    Bedeutung nicht — die Begruendung steht bei `buildTruckCostingOptions`.
 *
 * avoid -> Valhalla `use_*` mapping. Valhalla `use_*` default to `1`; setting a
 * flag to `0` makes the router avoid that class. We ONLY emit a `use_*` key
 * when the profile asks to avoid it, so that `avoid.X === false` leaves
 * Valhalla's default untouched (asserted by the negative test):
 *  - avoid.motorway -> use_highways = 0
 *  - avoid.toll     -> use_tolls    = 0
 *  - avoid.ferry    -> use_ferry    = 0
 *  - avoid.unpaved  -> use_tracks   = 0   (see KLÄRUNGSBEDARF below)
 *
 * ⚠️ KLÄRUNGSBEDARF (avoid.unpaved): Valhalla has NO exact "exclude unpaved"
 * switch. `use_tracks:0` (strongly avoid `highway=track`) is the closest
 * documented equivalent but is NOT identical: it does not cover every
 * `surface=unpaved` way, and it down-weights rather than hard-excludes. This
 * is mapped deliberately, not guessed; if a stricter guarantee is required the
 * data pipeline must additionally tag unpaved edges. Flagged for the
 * orchestrator to confirm.
 *
 * E03-T4 additions (temporary avoidances, all optional/backward-compatible):
 *  - `RouteRequest.exclude_locations` -> Valhalla `exclude_locations`, same
 *    `{lat, lon}` order, set only when non-empty.
 *  - `RouteRequest.exclude_polygons`  -> Valhalla `exclude_polygons`, rings
 *    converted from `{lat, lon}` to `[lon, lat]` tuples (⚠️ swapped order --
 *    see `toExcludePolygons` below), set only when non-empty.
 *  - `RouteRequest.avoid_overrides`   -> overrides the profile's `avoid.*`
 *    flags for THIS request only when building `costing_options.truck`; the
 *    profile itself is never mutated.
 */

import type {
  LatLng,
  RouteAvoidOverrides,
  RouteMode,
  RouteRequest,
  VehicleProfile,
} from '@yapaia/shared';
import type {
  ValhallaExcludeLocation,
  ValhallaExcludePolygonRing,
  ValhallaLocation,
  ValhallaRouteRequestBody,
  ValhallaTruckCostingOptions,
} from './types.js';

/** Das Valhalla-Kostenmodell, mit dem gefahren wird. Steht hier EINMAL --
 *  die Tempolimit-Abfrage (`speedLimits.ts`) muss dasselbe nennen, sonst
 *  liefert sie Limits fuer ein anderes Fahrzeug als die Route. */
export const VALHALLA_COSTING = 'truck';

/**
 * Valhallas eigene Vorgabe fuer `use_highways` -- `kDefaultUseHighways` in
 * `src/sif/truckcost.cc` (und gleichlautend in `autocost.cc`).
 *
 * Steht hier als benannte Zahl, weil ein eingetragener Wert, der zufaellig
 * GENAU die Vorgabe ist, nichts bewirkt und trotzdem nach einer Einstellung
 * aussieht. Bis 0.8.13 war das bei „Ausgewogen" der Fall. An dieser
 * Konstante laesst sich die Frage „wirkt das ueberhaupt?" pruefen, statt sie
 * jedes Mal neu nachzuschlagen.
 */
export const VALHALLA_VORGABE_USE_HIGHWAYS = 0.5;

/**
 * Map a profile to `costing_options.truck`. Pure + exhaustively tested.
 *
 * `avoidOverrides` (E03-T4) is the optional per-REQUEST override coming from
 * `RouteRequest.avoid_overrides` (e.g. the web UI's avoid chips): when a flag
 * is present it wins over the profile's own `avoid.*` flag for this call
 * ONLY -- the `profile` object itself is never mutated or persisted.
 */
export function buildTruckCostingOptions(
  profile: VehicleProfile,
  avoidOverrides?: RouteAvoidOverrides,
  mode: RouteMode = 'fastest',
): ValhallaTruckCostingOptions {
  const truck: ValhallaTruckCostingOptions = {
    height: profile.height_m,
    width: profile.width_m,
    length: profile.length_m,
    weight: profile.weight_t,
    hazmat: profile.hazmat,
  };
  // ─── KEIN `top_speed` AUS `avg_speed_kmh` ─────────────────────────────────
  // Bis 0.8.13 stand hier `top_speed: profile.avg_speed_kmh`. Die Einheit
  // stimmte (beides km/h) -- die BEDEUTUNG nicht, und genau daran ist es
  // vorbeigegangen.
  //
  // Gemeldet: „Kannst du prüfen warum die schnellste Route nicht über die
  // Autobahn A61 geht. Die kürzeste aber schon."
  //
  // `avg_speed_kmh` ist die REISEGESCHWINDIGKEIT (Vorgabe 85) und laut
  // `types.ts` ausdruecklich „used for ETA calculation". Valhallas
  // `top_speed` ist etwas anderes: die Hoechstgeschwindigkeit des Fahrzeugs,
  // und sie wirkt im Kostenmodell an ZWEI Stellen (nachgelesen in
  // `src/sif/truckcost.cc`, nicht vermutet):
  //
  //  1. `final_speed = min(edge_speed, truck_speed, top_speed_)`
  //     -- die Autobahn wurde also mit 85 km/h gerechnet statt mit ihrem
  //     echten Tempo. Damit war ihr Zeitvorteil weg.
  //
  //  2. `factor += ... + SpeedPenalty(...)` mit
  //     `SpeedPenalty = (edge_speed - top_speed) * 0.05`
  //     (`dynamiccost.h`, Vorgabe `kDefaultSpeedPenaltyFactor = 0.05f`)
  //     -- jede Strasse, die SCHNELLER als 85 ist, wurde zusaetzlich
  //     verteuert. Eine Autobahn mit 130 km/h bekam damit 2,25 auf einen
  //     Grundfaktor von etwa 1 aufgeschlagen, eine Landstrasse mit 80 nichts.
  //     In der Betriebsart „schnellste" waren die langsamen Strassen die
  //     billigsten. Das ist genau verkehrt herum.
  //
  // Warum „kuerzeste" trotzdem ueber die A61 ging: `truckcost.cc` steigt bei
  // `shortest` VOR diesem Faktorblock aus
  // (`if (shortest_) { return Cost(edge->length(), sec); }`). Die Strafe kam
  // dort also nie an. Die Ungereimtheit, die aufgefallen ist, war kein
  // Zufall -- sie war die Naht zwischen den beiden Zweigen.
  //
  // Ohne den Schluessel nimmt Valhalla seine eigene Vorgabe fuer `truck`
  // (`kMaxAssumedTruckSpeed = 120`), und die Strafe greift erst oberhalb von
  // 120 km/h -- also da, wofuer sie gedacht ist.
  //
  // Die ANKUNFTSZEIT verliert dadurch nichts: sie wird ohnehin getrennt
  // gerechnet (`navigation/eta.ts#computeEtaDuration` nimmt `avg_speed_kmh`
  // als Untergrenze). Die Reisegeschwindigkeit wirkt also weiter auf die
  // Zeitangabe -- nur nicht mehr auf die Wahl der Strasse.

  // Effective avoid = per-request override (if present) else the profile's
  // own flag. Only lower a `use_*` flag when the EFFECTIVE flag is true;
  // otherwise leave the key absent so Valhalla keeps its default of 1.
  const effectiveMotorway = avoidOverrides?.motorway ?? profile.avoid.motorway;
  const effectiveToll = avoidOverrides?.toll ?? profile.avoid.toll;
  const effectiveFerry = avoidOverrides?.ferry ?? profile.avoid.ferry;
  const effectiveUnpaved = avoidOverrides?.unpaved ?? profile.avoid.unpaved;

  if (effectiveMotorway) truck.use_highways = 0;
  if (effectiveToll) truck.use_tolls = 0;
  if (effectiveFerry) truck.use_ferry = 0;
  if (effectiveUnpaved) truck.use_tracks = 0;

  // ─── WONACH GESUCHT WIRD ──────────────────────────────────────────────────
  // Die Masse oben sind Zugangsbedingungen und gelten in JEDER Betriebsart
  // unveraendert. Was hier folgt, waehlt nur unter den erlaubten Routen aus.
  if (mode === 'shortest') {
    // Valhalla rechnet dann rein nach Entfernung.
    truck.shortest = true;
  } else if (mode === 'balanced' && !effectiveMotorway) {
    // „Ausgewogen" ist KEINE eingebaute Betriebsart von Valhalla, sondern
    // diese eine Zeile: Autobahnen werden etwas weniger gern genommen als in
    // „schnellste". Die Zeit bleibt das Mass -- die Autobahn wird also weiter
    // genommen, wenn sie deutlich schneller ist, aber ein langer Umweg
    // dorthin lohnt sich nicht mehr.
    //
    // ─── HIER STAND 0.5, UND DAS WAR WIRKUNGSLOS ────────────────────────────
    // Der Kommentar dazu behauptete „Vorgabe ist 1". Das stimmt fuer keines
    // der beiden Kostenmodelle: `kDefaultUseHighways = 0.5f` steht sowohl in
    // `src/sif/autocost.cc` als auch in `src/sif/truckcost.cc`. Der
    // eingetragene Wert war also GENAU die Vorgabe -- „Ausgewogen" und
    // „Schnellste" haben bis 0.8.13 dieselbe Route geliefert, und niemand
    // konnte den Unterschied sehen, weil es keinen gab.
    //
    // Valhalla rechnet daraus (`truckcost.cc`):
    //     use_highways >= 0.5 -> highway_factor_ = (0.5 - u)^3
    //     use_highways <  0.5 -> highway_factor_ = kMaxHighwayBiasFactor * (1 - 2u)^2
    // Bei 0.5 kommt 0 heraus: keine Vorliebe, in keine Richtung. Erst
    // UNTERHALB von 0.5 entsteht ein Abschlag. 0.25 ergibt den halben Weg
    // dorthin -- spuerbar, aber weit entfernt von „meiden" (das waere 0).
    //
    // Nur, wenn Autobahnen nicht ohnehin gemieden werden: sonst ueber-
    // schriebe diese Zeile die 0 von oben und machte aus einem „meiden" ein
    // „ein bisschen meiden". Genau die Sorte stiller Aufweichung, die man
    // spaeter nicht wiederfindet.
    truck.use_highways = 0.25;
  }

  return truck;
}

/** E03-T4: maps `RouteRequest.exclude_locations` 1:1 -- Valhalla's
 *  `exclude_locations` uses the SAME `{lat, lon}` order as everywhere else,
 *  unlike `exclude_polygons` below. */
function toExcludeLocations(points: readonly LatLng[]): ValhallaExcludeLocation[] {
  return points.map((p) => ({ lat: p.lat, lon: p.lon }));
}

/**
 * E03-T4: maps `RouteRequest.exclude_polygons` (rings of `{lat, lon}`,
 * app-internal order) to Valhalla's `exclude_polygons` (rings of `[lon, lat]`
 * TUPLES). ⚠️ This is the one field in the whole request body where Valhalla
 * expects GeoJSON-style `[lon, lat]` instead of `{lat, lon}` -- getting this
 * backwards silently excludes the wrong part of the planet, so the order is
 * asserted explicitly by the profile-mapping intercept test.
 */
function toExcludePolygons(polygons: readonly LatLng[][]): ValhallaExcludePolygonRing[] {
  return polygons.map((ring) => ring.map((p): [number, number] => [p.lon, p.lat]));
}

/** E03-T4: optional per-request temporary avoidances, see `RouteRequest`. */
export interface RouteExcludeOptions {
  excludeLocations?: readonly LatLng[];
  excludePolygons?: readonly LatLng[][];
  avoidOverrides?: RouteAvoidOverrides;
}

/**
 * Build the complete Valhalla `/route` request body.
 *
 * @param originLatLng resolved origin (caller has already turned `'current'`
 *   into a concrete LatLng, or rejected the request with NO_POSITION).
 * @param excludeOptions E03-T4: optional temporary avoidances
 *   (`exclude_locations`/`exclude_polygons`/`avoid_overrides`) from the
 *   `RouteRequest`. Each Valhalla field is only SET when the corresponding
 *   input array is non-empty; an absent/empty input leaves the key off the
 *   body entirely (matches the `use_*` "omit when unused" convention above).
 */
/**
 * Die Sprache, in der Valhalla die Manoevertexte formuliert.
 *
 * ─── WARUM DAS HIER STEHT ───────────────────────────────────────────────────
 * Gemeldet: „Der Text der naechsten Anweisung ist auf Englisch." Im Dashboard
 * stand „Enter the roundabout and take the 2nd exit onto B 44." Die Anfrage
 * schickte `units`, aber keine Sprache -- und ohne Angabe antwortet Valhalla
 * in `en-US`.
 *
 * Dass es in der App selbst nicht auffiel, hat einen eigenen Grund: die
 * gesprochene Ansage baut `navigation/instructions.ts#buildSayText` selbst auf
 * Deutsch, und die Manoeverkachel zeigt vor allem Pfeil und Strassenname. Der
 * englische Satz von Valhalla wurde also nur dort sichtbar, wo er unveraendert
 * durchgereicht wird: im Home-Assistant-Dashboard.
 *
 * Vorgabe ist Deutsch, nicht `en-US`: die gesamte Oberflaeche ist deutsch und
 * die Ansagen sind es auch. Eine englische Route in einer deutschen App waere
 * nicht neutral, sondern falsch.
 */
export function valhallaSprache(einstellung?: string | null): string {
  return einstellung === 'en' ? 'en-US' : 'de-DE';
}

export function buildValhallaRouteBody(
  originLatLng: LatLng,
  destination: LatLng,
  waypoints: readonly LatLng[],
  profile: VehicleProfile,
  alternatives: number,
  excludeOptions?: RouteExcludeOptions,
  originHeadingDeg?: number,
  sprache?: string,
  mode: RouteMode = 'fastest',
): ValhallaRouteRequestBody {
  const toLocation = (p: LatLng): ValhallaLocation => ({
    lat: p.lat,
    lon: p.lon,
    type: 'break',
  });

  // E04-T4 (W-05): the ORIGIN carries the current heading on a reroute so the
  // new route continues in the direction of travel (forward-facing first
  // instruction). Only the origin gets it; waypoints/destination never do.
  const origin = toLocation(originLatLng);
  if (originHeadingDeg !== undefined && Number.isFinite(originHeadingDeg)) {
    origin.heading = originHeadingDeg;
  }

  const locations: ValhallaLocation[] = [
    origin,
    ...waypoints.map(toLocation),
    toLocation(destination),
  ];

  const body: ValhallaRouteRequestBody = {
    locations,
    costing: VALHALLA_COSTING,
    costing_options: { truck: buildTruckCostingOptions(profile, excludeOptions?.avoidOverrides, mode) },
    directions_options: { units: 'kilometers', language: valhallaSprache(sprache) },
    alternates: alternatives,
  };

  const excludeLocations = excludeOptions?.excludeLocations;
  if (excludeLocations && excludeLocations.length > 0) {
    body.exclude_locations = toExcludeLocations(excludeLocations);
  }

  const excludePolygons = excludeOptions?.excludePolygons;
  if (excludePolygons && excludePolygons.length > 0) {
    body.exclude_polygons = toExcludePolygons(excludePolygons);
  }

  return body;
}

/** Narrow structural view of a `RouteRequest` the builder needs. */
export type RouteRequestLike = Pick<RouteRequest, 'waypoints' | 'alternatives'>;
