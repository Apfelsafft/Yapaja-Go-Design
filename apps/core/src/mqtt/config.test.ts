/**
 * Unit tests for `resolveMqttConfig` (E08-T1): the bridge is OPTIONAL --
 * `null` whenever no broker is configured anywhere (acceptance criterion 4),
 * settings win over env when both are present, default prefix is `yapaja`.
 */
import { describe, it, expect } from 'vitest';
import { MQTT_DEFAULT_PREFIX, resolveMqttConfig, type SettingsLookup } from './config.js';

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
