/**
 * Unit tests for `resolveMqttConfig` (E08-T1): the bridge is OPTIONAL --
 * `null` whenever no broker is configured anywhere (acceptance criterion 4),
 * settings win over env when both are present, default prefix is `yapaja`.
 */
import { describe, it, expect } from 'vitest';
import {
  MQTT_DEFAULT_PREFIX,
  MQTT_DEFAULT_DISCOVERY_PREFIX,
  resolveMqttConfig,
  resolveDiscoveryConfig,
  type SettingsLookup,
} from './config.js';

function settingsWith(mqtt: unknown): SettingsLookup {
  return { get: (key: string) => (key === 'mqtt' ? mqtt : undefined) };
}

describe('resolveMqttConfig', () => {
  it('returns null when neither settings nor env configure a broker', () => {
    expect(resolveMqttConfig({ env: {} })).toBeNull();
  });

  it('returns null when settings has no "mqtt" key and env is empty', () => {
    expect(resolveMqttConfig({ settings: settingsWith(undefined), env: {} })).toBeNull();
  });

  it('resolves from env vars alone, defaulting the prefix', () => {
    const config = resolveMqttConfig({
      env: { MQTT_BROKER_URL: 'mqtt://broker.local:1883' },
    });
    expect(config).toEqual({
      brokerUrl: 'mqtt://broker.local:1883',
      username: undefined,
      password: undefined,
      prefix: MQTT_DEFAULT_PREFIX,
    });
  });

  it('resolves username/password/prefix from env vars', () => {
    const config = resolveMqttConfig({
      env: {
        MQTT_BROKER_URL: 'mqtt://broker.local:1883',
        MQTT_USERNAME: 'ha',
        MQTT_PASSWORD: 'secret',
        MQTT_PREFIX: 'custom',
      },
    });
    expect(config).toEqual({
      brokerUrl: 'mqtt://broker.local:1883',
      username: 'ha',
      password: 'secret',
      prefix: 'custom',
    });
  });

  it('resolves from Settings alone (no env)', () => {
    const config = resolveMqttConfig({
      settings: settingsWith({ broker_url: 'mqtt://settings-broker:1883', prefix: 'from-settings' }),
      env: {},
    });
    expect(config).toEqual({
      brokerUrl: 'mqtt://settings-broker:1883',
      username: undefined,
      password: undefined,
      prefix: 'from-settings',
    });
  });

  it('Settings values take priority over env when both are present', () => {
    const config = resolveMqttConfig({
      settings: settingsWith({ broker_url: 'mqtt://settings-broker:1883', username: 'settings-user' }),
      env: { MQTT_BROKER_URL: 'mqtt://env-broker:1883', MQTT_USERNAME: 'env-user' },
    });
    expect(config?.brokerUrl).toBe('mqtt://settings-broker:1883');
    expect(config?.username).toBe('settings-user');
  });

  it('falls back to env for a field Settings omits, even when Settings sets others', () => {
    const config = resolveMqttConfig({
      settings: settingsWith({ broker_url: 'mqtt://settings-broker:1883' }), // no username in settings
      env: { MQTT_USERNAME: 'env-user' },
    });
    expect(config?.username).toBe('env-user');
  });

  it('ignores a malformed (non-object) "mqtt" settings value instead of throwing', () => {
    const config = resolveMqttConfig({
      settings: settingsWith('not-an-object'),
      env: { MQTT_BROKER_URL: 'mqtt://broker.local:1883' },
    });
    expect(config?.brokerUrl).toBe('mqtt://broker.local:1883');
  });
});

describe('resolveDiscoveryConfig (E08-T2)', () => {
  it('defaults to enabled, prefix "homeassistant", and a sensible configuration_url with nothing configured', () => {
    const config = resolveDiscoveryConfig({ env: {} });
    expect(config).toEqual({
      enabled: true,
      discoveryPrefix: MQTT_DEFAULT_DISCOVERY_PREFIX,
      configurationUrl: 'http://homeassistant.local:8080',
    });
  });

  it('Setting mqtt.discovery:false disables discovery (docs/04 §1 toggle)', () => {
    const config = resolveDiscoveryConfig({ settings: settingsWith({ discovery: false }), env: {} });
    expect(config.enabled).toBe(false);
  });

  it('Setting mqtt.discovery:true is honoured explicitly (not just "truthy")', () => {
    const config = resolveDiscoveryConfig({ settings: settingsWith({ discovery: true }), env: {} });
    expect(config.enabled).toBe(true);
  });

  it('env MQTT_DISCOVERY=false disables when no Settings value overrides it', () => {
    expect(resolveDiscoveryConfig({ env: { MQTT_DISCOVERY: 'false' } }).enabled).toBe(false);
    expect(resolveDiscoveryConfig({ env: { MQTT_DISCOVERY: '0' } }).enabled).toBe(false);
  });

  it('Settings mqtt.discovery wins over env MQTT_DISCOVERY when both are present', () => {
    const config = resolveDiscoveryConfig({
      settings: settingsWith({ discovery: true }),
      env: { MQTT_DISCOVERY: 'false' },
    });
    expect(config.enabled).toBe(true);
  });

  it('resolves discovery_prefix and configuration_url from Settings', () => {
    const config = resolveDiscoveryConfig({
      settings: settingsWith({ discovery_prefix: 'ha-custom', configuration_url: 'http://yapaja.local:8080' }),
      env: {},
    });
    expect(config.discoveryPrefix).toBe('ha-custom');
    expect(config.configurationUrl).toBe('http://yapaja.local:8080');
  });

  it('resolves discovery_prefix and configuration_url from env when Settings omit them', () => {
    const config = resolveDiscoveryConfig({
      env: {
        MQTT_DISCOVERY_PREFIX: 'env-prefix',
        MQTT_DISCOVERY_CONFIGURATION_URL: 'http://env-host:8080',
      },
    });
    expect(config.discoveryPrefix).toBe('env-prefix');
    expect(config.configurationUrl).toBe('http://env-host:8080');
  });

  it('ignores a malformed (non-object) "mqtt" settings value instead of throwing', () => {
    const config = resolveDiscoveryConfig({ settings: settingsWith('not-an-object'), env: {} });
    expect(config.enabled).toBe(true);
    expect(config.discoveryPrefix).toBe(MQTT_DEFAULT_DISCOVERY_PREFIX);
  });
});
