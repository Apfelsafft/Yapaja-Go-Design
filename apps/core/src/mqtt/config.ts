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
