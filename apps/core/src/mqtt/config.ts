/**
 * MQTT bridge configuration resolution (E08-T1): broker URL / username /
 * password / prefix come from Settings (the general-purpose `SettingsService`
 * key/value store, key `"mqtt"`) or environment variables, settings winning
 * when both are present (an explicit Settings-UI value should override a
 * deployment-wide env default). The bridge is OPTIONAL: `resolveMqttConfig`
 * returns `null` whenever no broker URL is configured anywhere, and
 * `buildServer` (index.ts) simply skips constructing the bridge in that case
 * -- the Core runs 100% normally without one (acceptance criterion 4).
 */

export interface MqttBridgeConfig {
  brokerUrl: string;
  username?: string;
  password?: string;
  prefix: string;
}

/** Just the settings lookup this module needs; the real `SettingsService`
 *  satisfies it structurally (no import needed, keeps this module trivially
 *  testable without a database). */
export interface SettingsLookup {
  get(key: string): unknown;
}

export interface ResolveMqttConfigInput {
  settings?: SettingsLookup;
  /** Defaults to `process.env`; overridable for tests. */
  env?: Record<string, string | undefined>;
}

const DEFAULT_PREFIX = 'yapaja';

interface MqttSettingsShape {
  broker_url?: unknown;
  username?: unknown;
  password?: unknown;
  prefix?: unknown;
}

function readMqttSettings(settings?: SettingsLookup): MqttSettingsShape {
  const raw = settings?.get('mqtt');
  if (!raw || typeof raw !== 'object') return {};
  return raw as MqttSettingsShape;
}

function firstString(...values: unknown[]): string | undefined {
  for (const value of values) {
    if (typeof value === 'string' && value.length > 0) return value;
  }
  return undefined;
}

export function resolveMqttConfig(input: ResolveMqttConfigInput = {}): MqttBridgeConfig | null {
  const env = input.env ?? process.env;
  const mqttSettings = readMqttSettings(input.settings);

  const brokerUrl = firstString(mqttSettings.broker_url, env.MQTT_BROKER_URL);
  if (!brokerUrl) return null;

  const username = firstString(mqttSettings.username, env.MQTT_USERNAME);
  const password = firstString(mqttSettings.password, env.MQTT_PASSWORD);
  const prefix = firstString(mqttSettings.prefix, env.MQTT_PREFIX) ?? DEFAULT_PREFIX;

  return { brokerUrl, username, password, prefix };
}

export { DEFAULT_PREFIX as MQTT_DEFAULT_PREFIX };

// --- HA auto-discovery resolution (E08-T2, docs/04 §1) ----------------------
//
// Deliberately a SEPARATE function/type from `resolveMqttConfig` above
// (rather than folding these fields into `MqttBridgeConfig`) so E08-T1's
// existing `resolveMqttConfig` callers/tests -- which assert the exact
// shape of its return value with `toEqual` -- are completely undisturbed;
// this is purely additive. Reads the SAME Settings key (`"mqtt"`), same
// settings-over-env precedence as `resolveMqttConfig`.

export interface MqttDiscoveryConfig {
  /** `false` -> publish NO discovery configs at all (state topics still flow, E08-T1 unaffected). */
  enabled: boolean;
  /** HA discovery-topic prefix, default `'homeassistant'`. */
  discoveryPrefix: string;
  /** HA `device.configuration_url` -- where HA should link to open the Yapaja UI. */
  configurationUrl?: string;
}

const DEFAULT_DISCOVERY_PREFIX = 'homeassistant';
// Yapaja and HA typically run on the SAME host (docs/04 §0: "auf demselben
// Mini-PC"), `homeassistant.local` is that host's usual mDNS name, and 8080
// is the Core's own default port (see `main()`'s `process.env.PORT ||
// '8080'` in index.ts) -- a reasonable default, always overridable.
const DEFAULT_CONFIGURATION_URL = 'http://homeassistant.local:8080';

interface MqttDiscoverySettingsShape {
  discovery?: unknown;
  discovery_prefix?: unknown;
  configuration_url?: unknown;
}

function readMqttDiscoverySettings(settings?: SettingsLookup): MqttDiscoverySettingsShape {
  const raw = settings?.get('mqtt');
  if (!raw || typeof raw !== 'object') return {};
  return raw as MqttDiscoverySettingsShape;
}

/** `'false'`/`'0'` (case-insensitive) disables; anything else (including unset) is enabled. */
function isEnvFalse(value: string | undefined): boolean {
  if (value === undefined) return false;
  const normalized = value.trim().toLowerCase();
  return normalized === 'false' || normalized === '0';
}

export function resolveDiscoveryConfig(input: ResolveMqttConfigInput = {}): MqttDiscoveryConfig {
  const env = input.env ?? process.env;
  const settings = readMqttDiscoverySettings(input.settings);

  let enabled = true;
  if (typeof settings.discovery === 'boolean') {
    enabled = settings.discovery;
  } else if (isEnvFalse(env.MQTT_DISCOVERY)) {
    enabled = false;
  }

  const discoveryPrefix =
    firstString(settings.discovery_prefix, env.MQTT_DISCOVERY_PREFIX) ?? DEFAULT_DISCOVERY_PREFIX;
  const configurationUrl =
    firstString(settings.configuration_url, env.MQTT_DISCOVERY_CONFIGURATION_URL) ?? DEFAULT_CONFIGURATION_URL;

  return { enabled, discoveryPrefix, configurationUrl };
}

export { DEFAULT_DISCOVERY_PREFIX as MQTT_DEFAULT_DISCOVERY_PREFIX };
