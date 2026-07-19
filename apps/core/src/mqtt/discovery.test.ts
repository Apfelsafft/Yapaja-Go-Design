/**
 * Unit tests for HA MQTT auto-discovery config builders (E08-T2).
 *
 * Mandatory deliverable: a FROZEN, exact-equality (`toEqual`) snapshot of
 * EVERY entity's discovery topic + payload, one `it()` per entity, plus the
 * `maneuverIcon` plausibility table (every coarse `ManeuverType` maps to a
 * real, existing mdi icon name -- `sensor.yapaja_instruction`'s `icon`
 * attribute must never show a broken/nonexistent icon in HA).
 */
import { describe, it, expect } from 'vitest';
import { maneuverIcon } from './mapping.js';
import {
  buildDiscoveryConfigs,
  buildSelectProfileConfig,
  type BuildDiscoveryOptions,
  type DiscoveryEntity,
} from './discovery.js';

const DEVICE = {
  identifiers: ['yapaja_go'],
  name: 'Yapaja Go',
  sw_version: '1.2.3',
  configuration_url: 'http://homeassistant.local:8080',
};

const BASE_OPTS: BuildDiscoveryOptions = {
  statePrefix: 'yapaja',
  discoveryPrefix: 'homeassistant',
  device: DEVICE,
  profileNames: ['Camper', 'Alkoven 7.5t'],
};

function configFor(configs: DiscoveryEntity[], topic: string): DiscoveryEntity {
  const found = configs.find((c) => c.topic === topic);
  if (!found) throw new Error(`no discovery config published for topic "${topic}"`);
  return found;
}

const AVAILABILITY = {
  availability_topic: 'yapaja/status',
  payload_available: 'online',
  payload_not_available: 'offline',
};

describe('buildDiscoveryConfigs (E08-T2, docs/04 §1) — frozen per-entity snapshots', () => {
  const configs = buildDiscoveryConfigs(BASE_OPTS);

  it('publishes exactly the 15 entities of the docs/04 §1 table, no more, no less', () => {
    expect(configs).toHaveLength(15);
    const topics = configs.map((c) => c.topic).sort();
    expect(topics).toEqual(
      [
        'homeassistant/sensor/yapaja_speed/config',
        'homeassistant/sensor/yapaja_speed_limit/config',
        'homeassistant/binary_sensor/yapaja_speeding/config',
        'homeassistant/sensor/yapaja_eta/config',
        'homeassistant/sensor/yapaja_distance_remaining/config',
        'homeassistant/sensor/yapaja_instruction/config',
        'homeassistant/sensor/yapaja_instruction_distance/config',
        'homeassistant/sensor/yapaja_altitude/config',
        'homeassistant/sensor/yapaja_nav_state/config',
        'homeassistant/device_tracker/yapaja_vehicle/config',
        'homeassistant/sensor/yapaja_destination/config',
        'homeassistant/button/yapaja_stop/config',
        'homeassistant/button/yapaja_pause/config',
        'homeassistant/button/yapaja_resume/config',
        'homeassistant/select/yapaja_profile/config',
      ].sort(),
    );
  });

  it('sensor.yapaja_speed', () => {
    const cfg = configFor(configs, 'homeassistant/sensor/yapaja_speed/config');
    expect(cfg.payload).toEqual({
      name: 'Speed',
      unique_id: 'yapaja_go_speed',
      device_class: 'speed',
      state_class: 'measurement',
      unit_of_measurement: 'km/h',
      state_topic: 'yapaja/nav/speed',
      value_template: '{{ value_json.speed_kmh }}',
      ...AVAILABILITY,
      device: DEVICE,
    });
  });

  it('sensor.yapaja_speed_limit', () => {
    const cfg = configFor(configs, 'homeassistant/sensor/yapaja_speed_limit/config');
    expect(cfg.payload).toEqual({
      name: 'Speed Limit',
      unique_id: 'yapaja_go_speed_limit',
      device_class: 'speed',
      state_class: 'measurement',
      unit_of_measurement: 'km/h',
      state_topic: 'yapaja/nav/speed',
      value_template: '{{ value_json.speed_limit_kmh }}',
      ...AVAILABILITY,
      device: DEVICE,
    });
  });

  it('binary_sensor.yapaja_speeding', () => {
    const cfg = configFor(configs, 'homeassistant/binary_sensor/yapaja_speeding/config');
    expect(cfg.payload).toEqual({
      name: 'Speeding',
      unique_id: 'yapaja_go_speeding',
      device_class: 'safety',
      state_topic: 'yapaja/nav/speed',
      value_template: "{{ 'ON' if value_json.speeding else 'OFF' }}",
      payload_on: 'ON',
      payload_off: 'OFF',
      ...AVAILABILITY,
      device: DEVICE,
    });
  });

  it('sensor.yapaja_eta', () => {
    const cfg = configFor(configs, 'homeassistant/sensor/yapaja_eta/config');
    expect(cfg.payload).toEqual({
      name: 'ETA',
      unique_id: 'yapaja_go_eta',
      device_class: 'timestamp',
      state_topic: 'yapaja/nav/eta',
      value_template: '{{ value_json.eta }}',
      ...AVAILABILITY,
      device: DEVICE,
    });
  });

  it('sensor.yapaja_distance_remaining (m -> km in the template)', () => {
    const cfg = configFor(configs, 'homeassistant/sensor/yapaja_distance_remaining/config');
    expect(cfg.payload).toEqual({
      name: 'Distance Remaining',
      unique_id: 'yapaja_go_distance_remaining',
      device_class: 'distance',
      state_class: 'measurement',
      unit_of_measurement: 'km',
      state_topic: 'yapaja/nav/eta',
      value_template:
        '{{ (value_json.distance_remaining_m / 1000) | round(2) if value_json.distance_remaining_m is not none else none }}',
      ...AVAILABILITY,
      device: DEVICE,
    });
  });

  it('sensor.yapaja_instruction (+ json_attributes carrying icon)', () => {
    const cfg = configFor(configs, 'homeassistant/sensor/yapaja_instruction/config');
    expect(cfg.payload).toEqual({
      name: 'Instruction',
      unique_id: 'yapaja_go_instruction',
      state_topic: 'yapaja/nav/instruction',
      value_template: '{{ value_json.instruction }}',
      json_attributes_topic: 'yapaja/nav/instruction',
      ...AVAILABILITY,
      device: DEVICE,
    });
  });

  it('sensor.yapaja_instruction_distance', () => {
    const cfg = configFor(configs, 'homeassistant/sensor/yapaja_instruction_distance/config');
    expect(cfg.payload).toEqual({
      name: 'Instruction Distance',
      unique_id: 'yapaja_go_instruction_distance',
      device_class: 'distance',
      state_class: 'measurement',
      unit_of_measurement: 'm',
      state_topic: 'yapaja/nav/instruction',
      value_template: '{{ value_json.distance_m }}',
      ...AVAILABILITY,
      device: DEVICE,
    });
  });

  it('sensor.yapaja_altitude', () => {
    const cfg = configFor(configs, 'homeassistant/sensor/yapaja_altitude/config');
    expect(cfg.payload).toEqual({
      name: 'Altitude',
      unique_id: 'yapaja_go_altitude',
      device_class: 'distance',
      state_class: 'measurement',
      unit_of_measurement: 'm',
      state_topic: 'yapaja/nav/altitude',
      value_template: '{{ value_json.altitude_m }}',
      ...AVAILABILITY,
      device: DEVICE,
    });
  });

  it('sensor.yapaja_nav_state (raw string payload, no value_template)', () => {
    const cfg = configFor(configs, 'homeassistant/sensor/yapaja_nav_state/config');
    expect(cfg.payload).toEqual({
      name: 'Nav State',
      unique_id: 'yapaja_go_nav_state',
      state_topic: 'yapaja/nav/state',
      ...AVAILABILITY,
      device: DEVICE,
    });
    expect(cfg.payload).not.toHaveProperty('value_template');
  });

  it('device_tracker.yapaja_vehicle (lat/lon remapped to latitude/longitude)', () => {
    const cfg = configFor(configs, 'homeassistant/device_tracker/yapaja_vehicle/config');
    expect(cfg.payload).toEqual({
      name: 'Vehicle',
      unique_id: 'yapaja_go_vehicle',
      source_type: 'gps',
      json_attributes_topic: 'yapaja/position',
      json_attributes_template:
        "{{ {'latitude': value_json.lat, 'longitude': value_json.lon, 'gps_accuracy': value_json.accuracy} | tojson }}",
      ...AVAILABILITY,
      device: DEVICE,
    });
  });

  it('sensor.yapaja_destination (name + json_attributes lat/lon, null-safe)', () => {
    const cfg = configFor(configs, 'homeassistant/sensor/yapaja_destination/config');
    expect(cfg.payload).toEqual({
      name: 'Destination',
      unique_id: 'yapaja_go_destination',
      state_topic: 'yapaja/nav/destination',
      value_template: '{{ value_json.name if value_json is not none else none }}',
      json_attributes_topic: 'yapaja/nav/destination',
      json_attributes_template:
        "{{ ({'lat': value_json.lat, 'lon': value_json.lon} if value_json is not none else {}) | tojson }}",
      ...AVAILABILITY,
      device: DEVICE,
    });
  });

  it('button.yapaja_stop / pause / resume -> cmd/navigation with the matching payload_press', () => {
    for (const [object, action, label] of [
      ['stop', 'stop', 'Stop'],
      ['pause', 'pause', 'Pause'],
      ['resume', 'resume', 'Resume'],
    ] as const) {
      const cfg = configFor(configs, `homeassistant/button/yapaja_${object}/config`);
      expect(cfg.payload).toEqual({
        name: label,
        unique_id: `yapaja_go_${object}`,
        command_topic: 'yapaja/cmd/navigation',
        payload_press: action,
        ...AVAILABILITY,
        device: DEVICE,
      });
    }
  });

  it('select.yapaja_profile — live options + a command_template producing {name} (matches parseProfileCommand)', () => {
    const cfg = configFor(configs, 'homeassistant/select/yapaja_profile/config');
    expect(cfg.payload).toEqual({
      name: 'Profile',
      unique_id: 'yapaja_go_profile',
      command_topic: 'yapaja/cmd/profile',
      command_template: "{{ {'name': value} | tojson }}",
      options: ['Camper', 'Alkoven 7.5t'],
      ...AVAILABILITY,
      device: DEVICE,
    });
  });
});

describe('buildSelectProfileConfig standalone (used for the profile-change-only republish)', () => {
  it('is identical to the select entity buildDiscoveryConfigs() produces', () => {
    const standalone = buildSelectProfileConfig(BASE_OPTS);
    const fromFullSet = configFor(
      buildDiscoveryConfigs(BASE_OPTS),
      'homeassistant/select/yapaja_profile/config',
    );
    expect(standalone).toEqual(fromFullSet);
  });

  it('reflects an updated live profile-name list', () => {
    const cfg = buildSelectProfileConfig({ ...BASE_OPTS, profileNames: ['Solo Profile'] });
    expect(cfg.payload.options).toEqual(['Solo Profile']);
  });
});

describe('device/availability are consistent across every entity', () => {
  const configs = buildDiscoveryConfigs(BASE_OPTS);

  it('every entity shares the exact same device block', () => {
    for (const cfg of configs) {
      expect(cfg.payload.device).toEqual(DEVICE);
    }
  });

  it('every entity uses yapaja/status for availability, online/offline', () => {
    for (const cfg of configs) {
      expect(cfg.payload.availability_topic).toBe('yapaja/status');
      expect(cfg.payload.payload_available).toBe('online');
      expect(cfg.payload.payload_not_available).toBe('offline');
    }
  });

  it('every entity has a stable, unique unique_id', () => {
    const ids = configs.map((c) => c.payload.unique_id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) {
      expect(id).toMatch(/^yapaja_go_[a-z_]+$/);
    }
  });

  it('a custom statePrefix/discoveryPrefix is honoured everywhere (no hardcoded "yapaja"/"homeassistant")', () => {
    const custom = buildDiscoveryConfigs({
      ...BASE_OPTS,
      statePrefix: 'my-yapaja',
      discoveryPrefix: 'ha-custom',
    });
    for (const cfg of custom) {
      expect(cfg.topic.startsWith('ha-custom/')).toBe(true);
      expect(cfg.payload.availability_topic).toBe('my-yapaja/status');
    }
  });
});

// --- Plausibility (E08-T2 acceptance): every coarse ManeuverType maps to a
// real, existing mdi icon name -- `sensor.yapaja_instruction`'s `icon`
// attribute (carried via `json_attributes_topic` above, sourced from
// `mapping.ts`'s `buildInstructionPayload`) must never be broken in HA. ----

/**
 * The coarse `ManeuverType` set `mapping.ts`'s `MANEUVER_ICON_MAP` actually
 * handles (matches `mapping.test.ts`'s own table) plus one intentionally
 * UNMAPPED Valhalla-style type to exercise the default-icon fallback path.
 */
const KNOWN_MANEUVER_TYPES = [
  'turn_left',
  'turn_right',
  'uturn_left',
  'uturn_right',
  'roundabout_enter',
  'roundabout_exit',
  'straight',
  'continue',
] as const;

/**
 * A reference allowlist of real Material Design Icons (materialdesignicons.com)
 * names -- exactly the icons `MANEUVER_ICON_MAP` (mapping.ts) + its default
 * fallback actually use. Verified to exist in the MDI set at authoring time;
 * this is the "gegen mdi-Namensliste" plausibility check docs/tasks/E08 §T2
 * asks for, done without adding an `@mdi/js` runtime dependency for a single
 * table test.
 */
const REAL_MDI_ICON_NAMES = new Set([
  'mdi:arrow-left-top',
  'mdi:arrow-right-top',
  'mdi:u-turn-left',
  'mdi:u-turn-right',
  'mdi:rotate-right',
  'mdi:arrow-top-right',
  'mdi:arrow-up',
  'mdi:navigation',
]);

describe('maneuverIcon plausibility — every ManeuverType maps to a real, non-empty mdi: name', () => {
  it.each(KNOWN_MANEUVER_TYPES)('%s -> a real mdi icon', (type) => {
    const icon = maneuverIcon(type);
    expect(icon).toMatch(/^mdi:[a-z-]+$/);
    expect(REAL_MDI_ICON_NAMES.has(icon)).toBe(true);
  });

  it('an unmapped/future Valhalla maneuver type still falls back to a real mdi icon (never empty/undefined)', () => {
    const icon = maneuverIcon('some_future_valhalla_type');
    expect(icon).toMatch(/^mdi:[a-z-]+$/);
    expect(REAL_MDI_ICON_NAMES.has(icon)).toBe(true);
  });
});
