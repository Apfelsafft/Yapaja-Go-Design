/**
 * Bus-payload -> MQTT-payload mappers (E08-T1, docs/03 §4 table). Pure
 * functions only -- no bus/MQTT-client access -- so each mapping is
 * independently unit-testable.
 */
import type { ManeuverType, NavInstructionPayload, NavState, Route } from '@yapaja/shared';

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

/** `yapaja/nav/instruction` (docs/03 §4). */
export function buildInstructionPayload(payload: NavInstructionPayload): MqttInstructionPayload {
  return {
    type: payload.maneuver.type,
    instruction: payload.maneuver.instruction,
    street_names: payload.maneuver.street_names,
    distance_m: payload.distance_m,
    icon: maneuverIcon(payload.maneuver.type),
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
  speed_limit_kmh: number | null;
  speeding: boolean;
}

/** `yapaja/nav/speed` (docs/03 §4). `speeding` is only ever true when BOTH
 *  values are known and the current speed exceeds the limit -- an unknown
 *  limit (null, "kein Tempolimit bekannt") never counts as speeding. */
export function buildSpeedPayload(state: NavState): MqttSpeedPayload {
  const speeding =
    state.speed_kmh !== null && state.speed_limit_kmh !== null && state.speed_kmh > state.speed_limit_kmh;
  return {
    speed_kmh: state.speed_kmh,
    speed_limit_kmh: state.speed_limit_kmh,
    speeding,
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
 * (`@yapaja/shared`), deduplicated in first-seen order (no invented ranking).
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
