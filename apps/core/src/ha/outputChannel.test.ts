/* eslint-disable no-undef -- `setTimeout` is a standard Node global (typed via
 * @types/node); same justification as the other backend test modules. */

/**
 * HA output-channel tests (E08-T3, acceptance #3): the correct HA service call
 * is made for a `sink=ha` announcement and for arrived / gps_lost_paused
 * notifications; browser-vs-HA exclusivity (W-23) is respected; and a
 * timeout/HTTP-error is swallowed so the Core/nav keeps working.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { EventBus } from '../bus/index.js';
import { HaOutputChannel } from './outputChannel.js';
import type { HaFetchLike, HaHttpResponseLike, HaClientLogger } from './client.js';
import type { HaSettingsLookup } from './config.js';

const CONN = { base_url: 'http://ha.local:8123', token: 'llt' };

function settings(ha: Record<string, unknown>): HaSettingsLookup {
  return { get: (key) => (key === 'ha' ? { ...CONN, ...ha } : undefined) };
}

interface RecordedCall {
  url: string;
  body: unknown;
  auth: string | undefined;
}

function recordingFetch(response: Partial<HaHttpResponseLike> = { ok: true, status: 200 }): {
  fetch: HaFetchLike;
  calls: RecordedCall[];
} {
  const calls: RecordedCall[] = [];
  const fetch: HaFetchLike = (url, init) => {
    calls.push({
      url,
      body: JSON.parse(init.body) as unknown,
      auth: init.headers.Authorization,
    });
    return Promise.resolve({ ok: true, status: 200, ...response } as HaHttpResponseLike);
  };
  return { fetch, calls };
}

const silentLogger: HaClientLogger = {
  info: () => {},
  warn: () => {},
  error: () => {},
};

function navInstruction(say: string) {
  return {
    maneuver: {
      index: 0,
      type: 'turn_left' as const,
      instruction: 'Links abbiegen',
      street_names: ['B27'],
      distance_m: 200,
      begin_shape_index: 0,
    },
    distance_m: 150,
    say,
  };
}

const flush = (): Promise<void> => new Promise((r) => setTimeout(r, 10));

describe('HaOutputChannel', () => {
  let bus: EventBus;

  beforeEach(() => {
    bus = new EventBus({ isProduction: false });
  });

  it('sink=ha: announces a nav/instruction via the configured tts service', async () => {
    const { fetch, calls } = recordingFetch();
    const channel = new HaOutputChannel({
      bus,
      settings: settings({
        announce_sink: 'ha',
        tts_service: 'tts.speak',
        tts_media_player: 'media_player.wohnmobil',
        tts_entity_id: 'tts.google_de',
        tts_language: 'de-DE',
      }),
      logger: silentLogger,
      env: {},
      fetch,
    });

    bus.publish('nav/instruction', navInstruction('In 150 Metern links abbiegen'));
    await flush();

    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe('http://ha.local:8123/api/services/tts/speak');
    expect(calls[0].auth).toBe('Bearer llt');
    expect(calls[0].body).toEqual({
      message: 'In 150 Metern links abbiegen',
      media_player_entity_id: 'media_player.wohnmobil',
      entity_id: 'tts.google_de',
      language: 'de-DE',
    });
    channel.dispose();
  });

  it('sink=browser (default): makes NO HA call for a nav/instruction (W-23 exclusivity)', async () => {
    const { fetch, calls } = recordingFetch();
    const channel = new HaOutputChannel({
      bus,
      settings: settings({ announce_sink: 'browser', tts_media_player: 'media_player.x' }),
      logger: silentLogger,
      env: {},
      fetch,
    });

    bus.publish('nav/instruction', navInstruction('sollte nicht gesprochen werden'));
    await flush();

    expect(calls).toHaveLength(0);
    channel.dispose();
  });

  it('does nothing when HA is not configured at all', async () => {
    const { fetch, calls } = recordingFetch();
    const channel = new HaOutputChannel({
      bus,
      settings: { get: () => undefined },
      logger: silentLogger,
      env: {},
      fetch,
    });

    bus.publish('nav/instruction', navInstruction('x'));
    bus.publish('event/arrived', { route_id: 'r1', destination: null, ts: new Date().toISOString() });
    await flush();

    expect(calls).toHaveLength(0);
    channel.dispose();
  });

  it('event/arrived -> notify service when notifications are enabled', async () => {
    const { fetch, calls } = recordingFetch();
    const channel = new HaOutputChannel({
      bus,
      settings: settings({ notify_enabled: true, notify_service: 'notify.mobile_app_phone' }),
      logger: silentLogger,
      env: {},
      fetch,
    });

    bus.publish('event/arrived', {
      route_id: 'r1',
      destination: { latlng: { lat: 47, lon: 9 }, name: 'Vaduz' },
      ts: new Date().toISOString(),
    });
    await flush();

    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe('http://ha.local:8123/api/services/notify/mobile_app_phone');
    expect(calls[0].body).toEqual({ title: 'Yapaja Go', message: 'Ziel erreicht: Vaduz' });
    channel.dispose();
  });

  it('event/gps_lost_paused -> notify service when enabled', async () => {
    const { fetch, calls } = recordingFetch();
    const channel = new HaOutputChannel({
      bus,
      settings: settings({ notify_enabled: true, notify_service: 'notify.mobile_app_phone' }),
      logger: silentLogger,
      env: {},
      fetch,
    });

    bus.publish('event/gps_lost_paused', { route_id: 'r1', ts: new Date().toISOString() });
    await flush();

    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe('http://ha.local:8123/api/services/notify/mobile_app_phone');
    expect((calls[0].body as { message: string }).message).toContain('GPS-Signal verloren');
    channel.dispose();
  });

  it('event/addon_notify (E09-T3 `ha.notify` scope) -> notify service, labelled with the add-on', async () => {
    const { fetch, calls } = recordingFetch();
    const channel = new HaOutputChannel({
      bus,
      settings: settings({ notify_enabled: true, notify_service: 'notify.mobile_app_phone' }),
      logger: silentLogger,
      env: {},
      fetch,
    });

    bus.publish('event/addon_notify', {
      addon_id: 'com.example.traffic',
      addon_name: 'Stauwarner',
      title: 'Stau A8',
      message: '12 km Stau voraus',
    });
    await flush();

    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe('http://ha.local:8123/api/services/notify/mobile_app_phone');
    // The add-on NAME is always in the title -- an add-on can never make a
    // notification look like it came from the Core.
    expect(calls[0].body).toEqual({
      title: 'Yapaja Go – Stauwarner',
      message: 'Stau A8: 12 km Stau voraus',
    });
    channel.dispose();
  });

  it('event/addon_notify obeys the SAME notify.enabled gate (an add-on cannot turn HA notifications on)', async () => {
    const { fetch, calls } = recordingFetch();
    const channel = new HaOutputChannel({
      bus,
      settings: settings({ notify_enabled: false, notify_service: 'notify.x' }),
      logger: silentLogger,
      env: {},
      fetch,
    });

    bus.publish('event/addon_notify', {
      addon_id: 'com.example.traffic',
      addon_name: 'Stauwarner',
      message: 'ignored',
    });
    await flush();

    expect(calls).toHaveLength(0);
    channel.dispose();
  });

  it('notifications gated OFF: no HA call for arrived/gps_lost_paused', async () => {
    const { fetch, calls } = recordingFetch();
    const channel = new HaOutputChannel({
      bus,
      settings: settings({ notify_enabled: false, notify_service: 'notify.x' }),
      logger: silentLogger,
      env: {},
      fetch,
    });

    bus.publish('event/arrived', { route_id: 'r1', destination: null, ts: new Date().toISOString() });
    bus.publish('event/gps_lost_paused', { route_id: 'r1', ts: new Date().toISOString() });
    await flush();

    expect(calls).toHaveLength(0);
    channel.dispose();
  });

  it('swallows a fetch rejection (timeout) -- the bus/Core keeps working', async () => {
    const rejectingFetch: HaFetchLike = () => {
      const err = new Error('The operation was aborted');
      err.name = 'AbortError';
      return Promise.reject(err);
    };
    let warned = false;
    const channel = new HaOutputChannel({
      bus,
      settings: settings({ announce_sink: 'ha', tts_media_player: 'media_player.x' }),
      logger: { ...silentLogger, warn: () => (warned = true) },
      env: {},
      fetch: rejectingFetch,
    });

    // Must NOT throw out of publish, and a subsequent bus subscriber still runs.
    let downstreamRan = false;
    bus.subscribe('nav/instruction', () => (downstreamRan = true));
    expect(() => bus.publish('nav/instruction', navInstruction('x'))).not.toThrow();
    await flush();

    expect(warned).toBe(true);
    expect(downstreamRan).toBe(true);
    channel.dispose();
  });

  it('swallows a non-2xx HTTP error', async () => {
    const { fetch } = recordingFetch({ ok: false, status: 500 });
    let warned = false;
    const channel = new HaOutputChannel({
      bus,
      settings: settings({ announce_sink: 'ha', tts_media_player: 'media_player.x' }),
      logger: { ...silentLogger, warn: () => (warned = true) },
      env: {},
      fetch,
    });

    expect(() => bus.publish('nav/instruction', navInstruction('x'))).not.toThrow();
    await flush();
    expect(warned).toBe(true);
    channel.dispose();
  });
});
