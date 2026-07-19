/**
 * HA MQTT auto-discovery configs (E08-T2, docs/04 §1 table + Wargame W-07).
 *
 * Pure, deterministic builder functions -- no bus/MQTT-client access -- so
 * every entity's discovery payload is independently unit-testable against a
 * frozen expected value (the mandatory "frozen snapshot per entity" test).
 * `bridge.ts` is the only caller: it publishes each `{topic, payload}` pair
 * RETAINED, on connect, on `<discoveryPrefix>/status` = `online` (HA
 * restart, W-07), and republishes just `select.yapaja_profile` whenever the
 * live profile list changes.
 *
 * Discovery topic shape (docs/04 §1): `<discoveryPrefix>/<component>/
 * yapaja_<object>/config`. All entities share one HA "device" (`identifiers:
 * ['yapaja_go']`) and one `availability_topic` (`<statePrefix>/status`,
 * `online`/`offline` -- exactly what E08-T1's LWT + connect-time publish
 * already produce, see `bridge.ts`'s `handleConnect`/`dispose`).
 *
 * `value_template`s are matched field-for-field against what `mapping.ts`'s
 * builders actually put on the wire (re-verify there before changing any
 * template here): `nav/eta` -> `{eta, duration_remaining_s,
 * distance_remaining_m}`, `nav/speed` -> `{speed_kmh, speed_limit_kmh,
 * speeding}`, `nav/instruction` -> `{type, instruction, street_names,
 * distance_m, icon}`, `nav/altitude` -> `{altitude_m}`, `nav/destination` ->
 * `{lat, lon, name}` or bare JSON `null`, `nav/state` -> the RAW `status`
 * string (no `value_json`, unlike every other `nav/*` topic), `position` ->
 * the raw `Position` shape (`lat`, `lon`, ... `accuracy`).
 */

export interface DiscoveryDevice {
  identifiers: string[];
  name: string;
  /** From the SAME `readPackageVersion()` result `/api/v1/health` reports (apps/core/src/index.ts). */
  sw_version: string;
  configuration_url?: string;
}

export interface DiscoveryEntity {
  /** Full discovery config topic: `<discoveryPrefix>/<component>/yapaja_<object>/config`. */
  topic: string;
  /** Retained JSON payload -- caller `JSON.stringify()`s this. */
  payload: Record<string, unknown>;
}

export interface BuildDiscoveryOptions {
  /** Yapaja state-topic prefix (E08-T1's `prefix`, default `'yapaja'`). */
  statePrefix: string;
  /** HA discovery-topic prefix (default `'homeassistant'`). */
  discoveryPrefix: string;
  device: DiscoveryDevice;
  /** Live profile names (`ProfileService#getAll()` order) -- `select.yapaja_profile`'s `options`. */
  profileNames: string[];
}

function discoveryTopic(discoveryPrefix: string, component: string, object: string): string {
  return `${discoveryPrefix}/${component}/yapaja_${object}/config`;
}

/** `availability_topic`/`payload_available`/`payload_not_available` block shared by every entity. */
function availabilityFields(statePrefix: string): Record<string, unknown> {
  return {
    availability_topic: `${statePrefix}/status`,
    payload_available: 'online',
    payload_not_available: 'offline',
  };
}

function uniqueId(object: string): string {
  return `yapaja_go_${object}`;
}

/**
 * `select.yapaja_profile` alone (docs/04 §1 + task: "bei Profil-CRUD:
 * Discovery-Update" republishes ONLY this entity, not the whole set --
 * everything else is unaffected by a profile create/rename/delete/activate).
 * Exported separately so `bridge.ts` can republish just this one on a
 * profile-list change instead of the full `buildDiscoveryConfigs()` set.
 */
export function buildSelectProfileConfig(opts: BuildDiscoveryOptions): DiscoveryEntity {
  const { statePrefix, discoveryPrefix, device, profileNames } = opts;
  return {
    topic: discoveryTopic(discoveryPrefix, 'select', 'profile'),
    payload: {
      name: 'Profile',
      unique_id: uniqueId('profile'),
      command_topic: `${statePrefix}/cmd/profile`,
      // `commands.ts`'s `parseProfileCommand` accepts `{id}` or `{name}` --
      // the select only ever knows the human-readable name, so `{name}`.
      command_template: "{{ {'name': value} | tojson }}",
      options: profileNames,
      ...availabilityFields(statePrefix),
      device,
    },
  };
}

/** Every OTHER discovery entity (docs/04 §1 table, minus `select.yapaja_profile`). */
function buildStaticConfigs(opts: BuildDiscoveryOptions): DiscoveryEntity[] {
  const { statePrefix, discoveryPrefix, device } = opts;
  const avail = availabilityFields(statePrefix);
  const topic = (component: string, object: string): string =>
    discoveryTopic(discoveryPrefix, component, object);

  return [
    {
      topic: topic('sensor', 'speed'),
      payload: {
        name: 'Speed',
        unique_id: uniqueId('speed'),
        device_class: 'speed',
        state_class: 'measurement',
        unit_of_measurement: 'km/h',
        state_topic: `${statePrefix}/nav/speed`,
        value_template: '{{ value_json.speed_kmh }}',
        ...avail,
        device,
      },
    },
    {
      topic: topic('sensor', 'speed_limit'),
      payload: {
        name: 'Speed Limit',
        unique_id: uniqueId('speed_limit'),
        device_class: 'speed',
        state_class: 'measurement',
        unit_of_measurement: 'km/h',
        state_topic: `${statePrefix}/nav/speed`,
        value_template: '{{ value_json.speed_limit_kmh }}',
        ...avail,
        device,
      },
    },
    {
      topic: topic('binary_sensor', 'speeding'),
      payload: {
        name: 'Speeding',
        unique_id: uniqueId('speeding'),
        device_class: 'safety',
        state_topic: `${statePrefix}/nav/speed`,
        value_template: "{{ 'ON' if value_json.speeding else 'OFF' }}",
        payload_on: 'ON',
        payload_off: 'OFF',
        ...avail,
        device,
      },
    },
    {
      topic: topic('sensor', 'eta'),
      payload: {
        name: 'ETA',
        unique_id: uniqueId('eta'),
        device_class: 'timestamp',
        state_topic: `${statePrefix}/nav/eta`,
        value_template: '{{ value_json.eta }}',
        ...avail,
        device,
      },
    },
    {
      topic: topic('sensor', 'distance_remaining'),
      payload: {
        name: 'Distance Remaining',
        unique_id: uniqueId('distance_remaining'),
        device_class: 'distance',
        state_class: 'measurement',
        unit_of_measurement: 'km',
        state_topic: `${statePrefix}/nav/eta`,
        // m -> km, null-safe (distance_remaining_m is `number | null`).
        value_template:
          '{{ (value_json.distance_remaining_m / 1000) | round(2) if value_json.distance_remaining_m is not none else none }}',
        ...avail,
        device,
      },
    },
    {
      topic: topic('sensor', 'instruction'),
      payload: {
        name: 'Instruction',
        unique_id: uniqueId('instruction'),
        state_topic: `${statePrefix}/nav/instruction`,
        value_template: '{{ value_json.instruction }}',
        // No json_attributes_template: the entire `{type, instruction,
        // street_names, distance_m, icon}` payload becomes attributes,
        // exactly the `icon` (mdi name for the maneuver arrow) attribute
        // docs/04 §1 asks for.
        json_attributes_topic: `${statePrefix}/nav/instruction`,
        ...avail,
        device,
      },
    },
    {
      topic: topic('sensor', 'instruction_distance'),
      payload: {
        name: 'Instruction Distance',
        unique_id: uniqueId('instruction_distance'),
        device_class: 'distance',
        state_class: 'measurement',
        unit_of_measurement: 'm',
        state_topic: `${statePrefix}/nav/instruction`,
        value_template: '{{ value_json.distance_m }}',
        ...avail,
        device,
      },
    },
    {
      topic: topic('sensor', 'altitude'),
      payload: {
        name: 'Altitude',
        unique_id: uniqueId('altitude'),
        device_class: 'distance',
        state_class: 'measurement',
        unit_of_measurement: 'm',
        state_topic: `${statePrefix}/nav/altitude`,
        value_template: '{{ value_json.altitude_m }}',
        ...avail,
        device,
      },
    },
    {
      topic: topic('sensor', 'nav_state'),
      payload: {
        name: 'Nav State',
        unique_id: uniqueId('nav_state'),
        // `yapaja/nav/state` is the RAW `status` string (bridge.ts's
        // `onNavState`), never JSON -- no value_template.
        state_topic: `${statePrefix}/nav/state`,
        ...avail,
        device,
      },
    },
    {
      topic: topic('device_tracker', 'vehicle'),
      payload: {
        name: 'Vehicle',
        unique_id: uniqueId('vehicle'),
        source_type: 'gps',
        // HA's MQTT device_tracker reads GPS position from `latitude`/
        // `longitude` (+ optional `gps_accuracy`) attribute keys, not the
        // Core's own `lat`/`lon`/`accuracy` field names -- remapped here.
        json_attributes_topic: `${statePrefix}/position`,
        json_attributes_template:
          "{{ {'latitude': value_json.lat, 'longitude': value_json.lon, 'gps_accuracy': value_json.accuracy} | tojson }}",
        ...avail,
        device,
      },
    },
    {
      topic: topic('sensor', 'destination'),
      payload: {
        name: 'Destination',
        unique_id: uniqueId('destination'),
        state_topic: `${statePrefix}/nav/destination`,
        // Payload is `{lat, lon, name}` OR bare JSON `null` (mapping.ts's
        // buildDestinationPayload) -- null-safe on both templates.
        value_template: '{{ value_json.name if value_json is not none else none }}',
        json_attributes_topic: `${statePrefix}/nav/destination`,
        json_attributes_template:
          "{{ ({'lat': value_json.lat, 'lon': value_json.lon} if value_json is not none else {}) | tojson }}",
        ...avail,
        device,
      },
    },
    {
      topic: topic('button', 'stop'),
      payload: {
        name: 'Stop',
        unique_id: uniqueId('stop'),
        command_topic: `${statePrefix}/cmd/navigation`,
        payload_press: 'stop',
        ...avail,
        device,
      },
    },
    {
      topic: topic('button', 'pause'),
      payload: {
        name: 'Pause',
        unique_id: uniqueId('pause'),
        command_topic: `${statePrefix}/cmd/navigation`,
        payload_press: 'pause',
        ...avail,
        device,
      },
    },
    {
      topic: topic('button', 'resume'),
      payload: {
        name: 'Resume',
        unique_id: uniqueId('resume'),
        command_topic: `${statePrefix}/cmd/navigation`,
        payload_press: 'resume',
        ...avail,
        device,
      },
    },
  ];
}

/** All 15 entities of docs/04 §1's table, retained + published together. */
export function buildDiscoveryConfigs(opts: BuildDiscoveryOptions): DiscoveryEntity[] {
  return [...buildStaticConfigs(opts), buildSelectProfileConfig(opts)];
}
