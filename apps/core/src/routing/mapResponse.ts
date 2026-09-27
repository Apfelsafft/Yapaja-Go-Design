/**
 * Map a Valhalla `/route` response onto the app-internal `Route[]` contract
 * (`@yapaia/shared`). Pure functions -- no I/O, fully unit-tested against a
 * realistic fixture.
 */

import { randomUUID } from 'crypto';
import type {
  LaneInfo,
  LatLng,
  Maneuver,
  ManeuverSign,
  Route,
  RouteLeg,
  RouteWarning,
  SpeedSegment,
} from '@yapaia/shared';
import { mapManeuverType } from './maneuverMapping.js';
import { joinLegShapes } from './polyline.js';
import { kreiselAngaben } from './kreisel.js';
import type {
  ValhallaLane,
  ValhallaRouteResponse,
  ValhallaSign,
  ValhallaSignElement,
  ValhallaTrip,
} from './types.js';

const EARTH_RADIUS_M = 6371000;

/**
 * Valhallas `sign`-Block auf unseren.
 *
 * ─── DIE EINZIGE STELLE, AN DER DIE NAMEN AUFEINANDERTREFFEN ────────────────
 * Valhalla nennt die Listen `exit_number_elements` und so fort; unsere
 * Schnittstelle laesst die Endung weg. Das ist eine Umbenennung, kein zweiter
 * Datenbestand -- sie geschieht hier und nirgends sonst, und der Uebersetzer
 * prueft sie.
 *
 * ─── WARUM LEERE LISTEN WEGFALLEN ───────────────────────────────────────────
 * Valhalla schickt an manchen Manoevern einen `sign`-Block, in dem alle vier
 * Listen leer sind. Unveraendert durchgereicht ergaebe das ein `sign: {}` --
 * und damit ein Feld, das „es gibt Schilder" behauptet, waehrend nichts
 * darauf steht. Die Anzeige zeichnete eine leere Tafel.
 *
 * Deshalb: leere Listen fallen weg, und bleibt nichts uebrig, faellt der
 * ganze Block weg. „Nichts" und „nichts darauf" sehen danach gleich aus, und
 * das ist hier richtig -- fuer den Fahrer ist es dasselbe.
 */
export function spreizeSchild(sign: ValhallaSign | undefined): { sign?: ManeuverSign } {
  if (!sign) return {};
  const gefiltert: ManeuverSign = {};
  const zuordnung = [
    ['exit_number', sign.exit_number_elements],
    ['exit_branch', sign.exit_branch_elements],
    ['exit_toward', sign.exit_toward_elements],
    ['exit_name', sign.exit_name_elements],
  ] as const;

  for (const [unser, ihre] of zuordnung) {
    if (!Array.isArray(ihre)) continue;
    // Eintraege ohne Aufschrift fallen weg: ein Schild ohne Text ist in der
    // Anzeige ein leeres Feld -- sichtbar, aber ohne Auskunft.
    const eintraege = ihre
      .filter((e): e is ValhallaSignElement => typeof e?.text === 'string' && e.text.length > 0)
      .map((e) => ({
        text: e.text,
        ...(typeof e.consecutive_count === 'number' ? { consecutive_count: e.consecutive_count } : {}),
      }));
    if (eintraege.length > 0) gefiltert[unser] = eintraege;
  }

  return Object.keys(gefiltert).length > 0 ? { sign: gefiltert } : {};
}

/**
 * Valhallas `lanes` auf unsere.
 *
 * Die Felder heissen gleich; was hier passiert, ist die Abwehr von
 * Unbrauchbarem. `directions` ist Pflicht -- eine Spur ohne jede Richtung
 * waere in der Anzeige ein leerer Kasten, der so aussieht, als fehle etwas.
 *
 * Kommt gar keine brauchbare Spur heraus, faellt das Feld weg statt als
 * leeres Array dazustehen: eine leere Spurliste hiesse „hier gibt es Spuren,
 * naemlich keine".
 */
export function spreizeSpuren(lanes: ValhallaLane[] | undefined): { lanes?: LaneInfo[] } {
  if (!Array.isArray(lanes)) return {};
  const brauchbar = lanes
    .filter((l): l is ValhallaLane => typeof l?.directions === 'number')
    .map((l) => ({
      directions: l.directions,
      ...(typeof l.valid === 'number' ? { valid: l.valid } : {}),
      ...(typeof l.active === 'number' ? { active: l.active } : {}),
    }));
  return brauchbar.length > 0 ? { lanes: brauchbar } : {};
}

/**
 * Great-circle distance in metres. Matches the Haversine used inside
 * `@yapaia/shared`'s `checkRoute` (same Earth radius) so the ROUTE_TOO_LONG
 * warning and the plausibility gate agree on the straight-line reference.
 */
export function haversineMeters(from: LatLng, to: LatLng): number {
  const dLat = ((to.lat - from.lat) * Math.PI) / 180;
  const dLon = ((to.lon - from.lon) * Math.PI) / 180;
  const lat1 = (from.lat * Math.PI) / 180;
  const lat2 = (to.lat * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.sin(dLon / 2) * Math.sin(dLon / 2) * Math.cos(lat1) * Math.cos(lat2);
  return EARTH_RADIUS_M * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/**
 * Build the route warnings.
 *
 * docs/03-api-spec.md §5 invariant: "Route-Distanz ... ≤ 4 × Luftlinie (sonst
 * RouteWarning + Log)". Emitted here as `ROUTE_TOO_LONG`.
 *
 * NOTE (W-08, restriction-data-missing warning): Valhalla's `/route` response
 * does not tell us which traversed edges lacked restriction attributes, so we
 * cannot raise that warning from here.
 * TODO(routing-restriction-warnings): enrich via `/trace_attributes` and add a
 * per-edge "restriction data missing" `RouteWarning` once available.
 */
export function buildRouteWarnings(
  distanceM: number,
  origin: LatLng,
  destination: LatLng,
): RouteWarning[] {
  const warnings: RouteWarning[] = [];
  const straightLineM = haversineMeters(origin, destination);
  if (straightLineM > 0 && distanceM > 4 * straightLineM) {
    warnings.push({
      code: 'ROUTE_TOO_LONG',
      message:
        `Route distance ${Math.round(distanceM)} m exceeds 4× the straight-line ` +
        `distance (${Math.round(straightLineM)} m) between origin and destination`,
    });
  }
  return warnings;
}

function mapTrip(trip: ValhallaTrip, origin: LatLng, destination: LatLng): Route {
  const { geometry, offsets } = joinLegShapes(trip.legs.map((leg) => leg.shape));

  const legs: RouteLeg[] = trip.legs.map((leg, index) => ({
    index,
    distance_m: leg.summary.length * 1000,
    duration_s: leg.summary.time,
  }));

  const maneuvers: Maneuver[] = [];
  trip.legs.forEach((leg, legIndex) => {
    const legOffset = offsets[legIndex] ?? 0;
    const kreisel = kreiselAngaben(leg.maneuvers);
    for (const [i, m] of leg.maneuvers.entries()) {
      maneuvers.push({
        index: maneuvers.length,
        type: mapManeuverType(m.type),
        instruction: m.instruction ?? '',
        street_names: m.street_names ?? [],
        distance_m: m.length * 1000,
        // Re-base the leg-local shape index onto the joined route geometry.
        begin_shape_index: legOffset + m.begin_shape_index,
        // E04-T2 ETA input: Valhalla's per-maneuver `time` (seconds), when
        // present. Conditionally spread rather than `duration_s: m.time` so a
        // missing Valhalla field stays ABSENT (not an explicit `undefined`
        // key) -- keeps the object exactly what the (additionalProperties:
        // false) maneuverSchema expects.
        ...(m.time !== undefined ? { duration_s: m.time } : {}),
        // Schilder und Spuren -- dieselbe bedingte Schreibweise und aus
        // demselben Grund: ein fehlendes Feld bleibt ABWESEND statt
        // ausdruecklich `undefined` zu sein.
        ...spreizeSchild(m.sign),
        ...spreizeSpuren(m.lanes),
        ...kreisel[i],
      });
    }
  });

  // Valhalla `/route` does not return per-segment speed limits (that needs
  // `/trace_attributes`). Per docs/03-api-spec.md §1 we therefore leave
  // `speed_limits` empty rather than fabricate values.
  // TODO(routing-speed-limits): populate via `/trace_attributes` enrichment.
  const speed_limits: SpeedSegment[] = [];

  const distance_m = trip.summary.length * 1000;
  const duration_s = trip.summary.time;

  return {
    id: randomUUID(),
    distance_m,
    duration_s,
    geometry,
    legs,
    maneuvers,
    speed_limits,
    warnings: buildRouteWarnings(distance_m, origin, destination),
  };
}

/**
 * Map the primary trip plus any alternates into `Route[]`. Order: primary
 * route first, then alternates in Valhalla's order.
 */
export function mapValhallaResponse(
  response: ValhallaRouteResponse,
  origin: LatLng,
  destination: LatLng,
): Route[] {
  const trips: ValhallaTrip[] = [response.trip, ...(response.alternates ?? []).map((a) => a.trip)];
  return trips.map((trip) => mapTrip(trip, origin, destination));
}
