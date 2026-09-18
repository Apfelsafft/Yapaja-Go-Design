/**
 * Bus-payload -> MQTT-payload mappers (E08-T1, docs/03 §4 table). Pure
 * functions only -- no bus/MQTT-client access -- so each mapping is
 * independently unit-testable.
 */
import {
  massgeblichesTempo,
  faehrtZuSchnell,
  type Tempoquelle,
} from '../routing/fahrzeugTempo.js';
import type { ManeuverType, NavInstructionPayload, NavState, Route } from '@yapaia/shared';

/**
 * `ManeuverType` -> mdi icon name for `yapaja/nav/instruction`'s `icon`
 * field (docs/03 §4: "icon = mdi-Name für Richtungspfeil"). Deliberately a
 * small, coarse table -- E08-T2 (HA auto-discovery) is where the full
 * per-entity icon story gets refined; this is just enough for a sensible
 * arrow in a generic HA sensor attribute.
 */
const MANEUVER_ICON_MAP: Readonly<Record<string, string>> = {
  turn_left: 'mdi:arrow-left-top',
  turn_right: 'mdi:arrow-right-top',
  uturn_left: 'mdi:u-turn-left',
  uturn_right: 'mdi:u-turn-right',
  roundabout_enter: 'mdi:rotate-right',
  roundabout_exit: 'mdi:arrow-top-right',
  straight: 'mdi:arrow-up',
  continue: 'mdi:arrow-up',
};

const DEFAULT_MANEUVER_ICON = 'mdi:navigation';

export function maneuverIcon(type: ManeuverType): string {
  return MANEUVER_ICON_MAP[type] ?? DEFAULT_MANEUVER_ICON;
}

export interface MqttInstructionPayload {
  type: ManeuverType;
  instruction: string;
  street_names: string[];
  distance_m: number;
  icon: string;
}

/**
 * `yapaja/nav/instruction` (docs/03 §4) -- die ANSAGE.
 *
 * Achtung, das ist ein Ereignis, kein Zustand: es entsteht nur, wenn die
 * Ansage-Schwelle ueberschritten wird, und `distance_m` ist die Entfernung in
 * genau diesem Augenblick. Wer daraus eine ANZEIGE speist, bekommt einen Wert,
 * der zwischen zwei Ansagen steht -- siehe {@link buildManeuverPayload}.
 */
export function buildInstructionPayload(payload: NavInstructionPayload): MqttInstructionPayload {
  return {
    type: payload.maneuver.type,
    instruction: payload.maneuver.instruction,
    street_names: payload.maneuver.street_names,
    distance_m: payload.distance_m,
    icon: maneuverIcon(payload.maneuver.type),
  };
}

/**
 * `yapaja/nav/maneuver` -- dasselbe Manoever, aber als ZUSTAND.
 *
 * ─── WARUM ES DAS GEBEN MUSS ────────────────────────────────────────────────
 * Gemeldet: „Die Strecke bis zur naechsten Abbiegung wird nicht geupdated. Die
 * anderen Werte wohl schon."
 *
 * Genau so sah es aus, und die Ursache steht im Typ selbst: `distance_m` in
 * `NavInstructionPayload` ist laut eigener Beschreibung „the distance to the
 * maneuver AT THE MOMENT the threshold fired". Zwischen zwei Ansagen aendert
 * sich dieser Wert nie. Tempo, Ankunft und Reststrecke kommen dagegen aus
 * `nav/state` im Sekundentakt -- deshalb liefen die.
 *
 * Betroffen war nicht nur die Entfernung: auch der TEXT stand still. Nach
 * einer Abbiegung zeigte die Anzeige weiter die eben absolvierte Anweisung,
 * bis fuer die naechste eine Schwelle fiel. Bei 3 km bis zum naechsten
 * Manoever sind das Minuten mit einer Anweisung, die man schon hinter sich
 * hat -- schlimmer als eine eingefrorene Zahl, weil sie falsch ist statt alt.
 *
 * Diese Nutzlast kommt deshalb aus `NavState`: `next_maneuver` und
 * `distance_to_maneuver_m` werden bei jedem Takt neu gebildet.
 */
export function buildManeuverPayload(state: NavState): MqttInstructionPayload | null {
  if (!state.next_maneuver) return null;
  return {
    type: state.next_maneuver.type,
    instruction: state.next_maneuver.instruction,
    street_names: state.next_maneuver.street_names,
    // `distance_to_maneuver_m` kann `null` sein (kein Fix, kein Fortschritt);
    // dann steht hier 0 statt einer erfundenen Entfernung.
    distance_m: state.distance_to_maneuver_m ?? 0,
    icon: maneuverIcon(state.next_maneuver.type),
  };
}

export interface MqttEtaPayload {
  eta: string | null;
  duration_remaining_s: number | null;
  distance_remaining_m: number | null;
}

/** `yapaja/nav/eta` (docs/03 §4). */
export function buildEtaPayload(state: NavState): MqttEtaPayload {
  return {
    eta: state.eta,
    duration_remaining_s: state.duration_remaining_s,
    distance_remaining_m: state.distance_remaining_m,
  };
}

export interface MqttSpeedPayload {
  speed_kmh: number | null;
  /** Das AUSGESCHILDERTE Limit. Unveraendert -- auch wenn es hoeher liegt. */
  speed_limit_kmh: number | null;
  /** Was DIESES Fahrzeug hier darf, oder `null`. */
  speed_limit_vehicle_kmh: number | null;
  /** Die niedrigere der beiden bekannten Zahlen -- danach wird gewarnt. */
  speed_limit_effective_kmh: number | null;
  /** Woher diese Zahl kommt: `schild`, `fahrzeug` oder `keine`. */
  speed_limit_source: Tempoquelle;
  speeding: boolean;
}

/**
 * `yapaja/nav/speed` (docs/03 §4).
 *
 * ─── WAS SICH MIT 0.14.0 GEAENDERT HAT ──────────────────────────────────────
 * Hier stand:
 *
 *     state.speed_kmh > state.speed_limit_kmh
 *
 * Also: gewarnt wurde allein am SCHILD. Das ist das Limit fuer einen PKW.
 * Ein Wohnmobil ueber 3,5 t darf weniger, und auf einer deutschen Autobahn
 * ohne Begrenzung gibt es gar kein Schild -- `speed_limit_kmh` war dort
 * `null`, und damit blieb `speeding` auch bei 130 km/h aus. Eine
 * Uebertretung um fuenfzig, die als „alles in Ordnung" durchging.
 *
 * Jetzt entscheidet die NIEDRIGERE der beiden bekannten Zahlen. Beide reisen
 * weiterhin einzeln mit: zusammengelegt stuende „80" auf einem runden Schild,
 * das an dieser Autobahn nicht steht.
 *
 * Unveraendert bleibt die vorsichtige Regel: `speeding` ist nur `true`, wenn
 * Tempo UND Grenze bekannt sind. Eine unbekannte Grenze ist keine
 * Uebertretung.
 */
export function buildSpeedPayload(state: NavState): MqttSpeedPayload {
  const massgeblich = massgeblichesTempo(state.speed_limit_kmh, state.speed_limit_vehicle_kmh);
  return {
    speed_kmh: state.speed_kmh,
    speed_limit_kmh: state.speed_limit_kmh,
    speed_limit_vehicle_kmh: state.speed_limit_vehicle_kmh,
    speed_limit_effective_kmh: massgeblich.grenze,
    speed_limit_source: massgeblich.quelle,
    speeding: faehrtZuSchnell(state.speed_kmh, massgeblich.grenze),
  };
}

export interface MqttAltitudePayload {
  altitude_m: number | null;
}

/** `yapaja/nav/altitude` (docs/03 §4). */
export function buildAltitudePayload(state: NavState): MqttAltitudePayload {
  return { altitude_m: state.altitude_m };
}

export interface MqttDestinationPayload {
  lat: number;
  lon: number;
  name: string | null;
}

/** `yapaja/nav/destination` (docs/03 §4): `{lat, lon, name}` or `null`. */
export function buildDestinationPayload(state: NavState): MqttDestinationPayload | null {
  if (!state.destination) return null;
  return {
    lat: state.destination.latlng.lat,
    lon: state.destination.latlng.lon,
    name: state.destination.name,
  };
}

export interface MqttRouteSummaryPayload {
  distance_m: number;
  duration_s: number;
  via: string[];
}

/**
 * `yapaja/route/summary` (docs/03 §4): `via` is the ordered list of unique,
 * non-empty street names encountered across the route's maneuvers -- the
 * same `street_names` Valhalla already attaches to each `Maneuver`
 * (`@yapaia/shared`), deduplicated in first-seen order (no invented ranking).
 */
export function buildRouteSummaryPayload(route: Route): MqttRouteSummaryPayload {
  const seen = new Set<string>();
  const via: string[] = [];
  for (const maneuver of route.maneuvers) {
    for (const name of maneuver.street_names) {
      if (name && !seen.has(name)) {
        seen.add(name);
        via.push(name);
      }
    }
  }
  return { distance_m: route.distance_m, duration_s: route.duration_s, via };
}
