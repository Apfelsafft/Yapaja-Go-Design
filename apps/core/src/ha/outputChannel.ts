/**
 * HA output channel (E08-T3, docs/04 §2): a core-side bus subscriber that
 * forwards navigation announcements + events to Home Assistant, gated entirely
 * by Settings (default OFF). It is the Yapaja -> HA direction (the MQTT bridge
 * is the parameter/telemetry direction).
 *
 *  - `nav/instruction`  -> HA TTS via `tts.speak` (configurable service +
 *    media_player target), but ONLY when the announcement sink is set to
 *    `'ha'`. This is the W-23 mutually-exclusive choice: `'browser'` (default)
 *    leaves the browser Web-Speech path untouched and makes NO HA call, so the
 *    two announcement channels are never both active.
 *  - `event/arrived`         -> HA `notify.<service>` (gated by `notify.enabled`).
 *  - `event/gps_lost_paused` -> HA `notify.<service>` (gated by `notify.enabled`).
 *
 * Config is resolved LIVE on every event (`resolveHaConfig`), so flipping a
 * setting takes effect immediately. When HA is unconfigured/unreachable
 * (`resolveHaConfig` -> `null`) every handler is a no-op. All HA HTTP is done
 * through `callHaService`, which times out + swallows errors, so nothing here
 * can ever throw into the bus dispatch loop.
 */

import type { ArrivedPayload, EventBus, GpsLostPausedPayload } from '../bus/index.js';
import type { NavInstructionPayload } from '@yapaja/shared';
import {
  resolveHaConfig,
  type HaConfig,
  type HaSettingsLookup,
  type ResolveHaConfigInput,
} from './config.js';
import { callHaService, type HaClientLogger, type HaFetchLike } from './client.js';

/** Splits a `"domain.service"` string; returns `null` when malformed. */
function splitService(full: string): { domain: string; service: string } | null {
  const dot = full.indexOf('.');
  if (dot <= 0 || dot === full.length - 1) return null;
  return { domain: full.slice(0, dot), service: full.slice(dot + 1) };
}

export interface HaOutputChannelOptions {
  bus: EventBus;
  settings?: HaSettingsLookup;
  logger: HaClientLogger;
  /** Defaults to `process.env`; overridable for tests. */
  env?: Record<string, string | undefined>;
  /** Injectable HA transport (tests); defaults to the real `fetch`. */
  fetch?: HaFetchLike;
  /** Overrides HA request timeout (ms); mainly for tests. */
  timeoutMs?: number;
}

export class HaOutputChannel {
  private readonly bus: EventBus;
  private readonly settings?: HaSettingsLookup;
  private readonly logger: HaClientLogger;
  private readonly env?: Record<string, string | undefined>;
  private readonly fetchImpl?: HaFetchLike;
  private readonly timeoutMs?: number;
  private readonly unsubscribers: Array<() => void> = [];

  constructor(opts: HaOutputChannelOptions) {
    this.bus = opts.bus;
    this.settings = opts.settings;
    this.logger = opts.logger;
    this.env = opts.env;
    this.fetchImpl = opts.fetch;
    this.timeoutMs = opts.timeoutMs;

    this.unsubscribers.push(
      this.bus.subscribe('nav/instruction', (payload) => {
        void this.onInstruction(payload);
      }),
      this.bus.subscribe('event/arrived', (payload) => {
        void this.onArrived(payload);
      }),
      this.bus.subscribe('event/gps_lost_paused', (payload) => {
        void this.onGpsLostPaused(payload);
      }),
    );
  }

  private resolve(): HaConfig | null {
    const input: ResolveHaConfigInput = { settings: this.settings, env: this.env };
    return resolveHaConfig(input);
  }

  private async call(
    config: HaConfig,
    full: string,
    data: Record<string, unknown>,
  ): Promise<void> {
    const parsed = splitService(full);
    if (!parsed) {
      this.logger.warn('HA service is not a valid "domain.service" string', { service: full });
      return;
    }
    await callHaService(
      { connection: config.connection, domain: parsed.domain, service: parsed.service, data },
      { fetch: this.fetchImpl, logger: this.logger, timeoutMs: this.timeoutMs },
    );
  }

  /** `nav/instruction` -> HA TTS, but only when the sink is `'ha'` (W-23). */
  private async onInstruction(payload: NavInstructionPayload): Promise<void> {
    const config = this.resolve();
    if (!config) return;
    // W-23 exclusivity: browser sink -> the browser speaks, HA stays silent.
    if (config.announceSink !== 'ha') return;

    const data: Record<string, unknown> = { message: payload.say };
    if (config.tts.mediaPlayerEntityId) {
      data.media_player_entity_id = config.tts.mediaPlayerEntityId;
    }
    if (config.tts.ttsEntityId) {
      data.entity_id = config.tts.ttsEntityId;
    }
    if (config.tts.language) {
      data.language = config.tts.language;
    }
    await this.call(config, config.tts.service, data);
  }

  /** `event/arrived` -> HA notification (gated by `notify.enabled`). */
  private async onArrived(payload: ArrivedPayload): Promise<void> {
    const config = this.resolve();
    if (!config || !config.notify.enabled) return;
    const name = payload.destination?.name;
    await this.call(config, config.notify.service, {
      title: 'Yapaja Go',
      message: name ? `Ziel erreicht: ${name}` : 'Ziel erreicht.',
    });
  }

  /** `event/gps_lost_paused` -> HA notification (gated by `notify.enabled`). */
  private async onGpsLostPaused(_payload: GpsLostPausedPayload): Promise<void> {
    const config = this.resolve();
    if (!config || !config.notify.enabled) return;
    await this.call(config, config.notify.service, {
      title: 'Yapaja Go',
      message: 'GPS-Signal verloren – Navigation pausiert.',
    });
  }

  dispose(): void {
    for (const unsub of this.unsubscribers) unsub();
    this.unsubscribers.length = 0;
  }
}
