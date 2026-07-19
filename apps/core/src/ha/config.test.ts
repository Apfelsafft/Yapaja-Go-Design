/**
 * Unit tests for HA output-channel config resolution (E08-T3).
 */

import { describe, it, expect } from 'vitest';
import {
  resolveHaConnection,
  resolveHaConfig,
  SUPERVISOR_API_BASE,
  DEFAULT_TTS_SERVICE,
  type HaSettingsLookup,
} from './config.js';

function settings(ha: unknown): HaSettingsLookup {
  return { get: (key) => (key === 'ha' ? ha : undefined) };
}

describe('resolveHaConnection', () => {
  it('returns null when nothing is configured', () => {
    expect(resolveHaConnection({ env: {} })).toBeNull();
  });

  it('uses explicit base_url + token from settings, appending /api', () => {
    const conn = resolveHaConnection({
      settings: settings({ base_url: 'http://homeassistant.local:8123', token: 'llt' }),
      env: {},
    });
    expect(conn).toEqual({ apiBase: 'http://homeassistant.local:8123/api', token: 'llt' });
  });

  it('strips a trailing slash before appending /api', () => {
    const conn = resolveHaConnection({
      settings: settings({ base_url: 'http://ha.local:8123/', token: 'llt' }),
      env: {},
    });
    expect(conn?.apiBase).toBe('http://ha.local:8123/api');
  });

  it('falls back to the Supervisor proxy when SUPERVISOR_TOKEN is set', () => {
    const conn = resolveHaConnection({ env: { SUPERVISOR_TOKEN: 'sup' } });
    expect(conn).toEqual({ apiBase: SUPERVISOR_API_BASE, token: 'sup' });
  });

  it('prefers explicit settings over the Supervisor proxy', () => {
    const conn = resolveHaConnection({
      settings: settings({ base_url: 'http://ha.local:8123', token: 'llt' }),
      env: { SUPERVISOR_TOKEN: 'sup' },
    });
    expect(conn?.token).toBe('llt');
  });
});

describe('resolveHaConfig', () => {
  it('returns null when no connection is available', () => {
    expect(resolveHaConfig({ env: {} })).toBeNull();
  });

  it('defaults announce sink to browser and notify disabled', () => {
    const cfg = resolveHaConfig({ env: { SUPERVISOR_TOKEN: 'sup' } });
    expect(cfg?.announceSink).toBe('browser');
    expect(cfg?.notify.enabled).toBe(false);
    expect(cfg?.tts.service).toBe(DEFAULT_TTS_SERVICE);
  });

  it('reads the full ha config from settings', () => {
    const cfg = resolveHaConfig({
      settings: settings({
        base_url: 'http://ha.local:8123',
        token: 'llt',
        announce_sink: 'ha',
        tts_service: 'tts.cloud_say',
        tts_media_player: 'media_player.wohnmobil',
        tts_entity_id: 'tts.google_de',
        tts_language: 'de-DE',
        notify_enabled: true,
        notify_service: 'notify.mobile_app_phone',
      }),
      env: {},
    });
    expect(cfg?.announceSink).toBe('ha');
    expect(cfg?.tts).toEqual({
      service: 'tts.cloud_say',
      mediaPlayerEntityId: 'media_player.wohnmobil',
      ttsEntityId: 'tts.google_de',
      language: 'de-DE',
    });
    expect(cfg?.notify).toEqual({ enabled: true, service: 'notify.mobile_app_phone' });
  });
});
