/**
 * Home-Assistant output-channel configuration (E08-T3, docs/04 §2).
 *
 * Two things live here, both resolved from the Settings key `"ha"` (with env
 * fallbacks), read LIVE per event so toggling a setting takes effect without a
 * restart:
 *
 *  1. WHERE to reach HA's REST API (`apiBase` + bearer `token`):
 *       - explicit Settings `ha.base_url` + `ha.token` (a long-lived token), OR
 *       - the Supervisor proxy `http://supervisor/core/api` + env
 *         `SUPERVISOR_TOKEN` when running as an HA add-on.
 *     `resolveHaConnection` returns `null` when neither is configured -- the
 *     whole channel then does nothing (default OFF; a down/unconfigured HA must
 *     never affect the Core).
 *
 *  2. WHAT to do:
 *       - `announceSink`: `'browser'` (default) XOR `'ha'` -- the W-23
 *         mutually-exclusive announcement sink. Only `'ha'` triggers HA TTS;
 *         `'browser'` leaves the browser Web-Speech path untouched.
 *       - `tts.*`: the configurable `tts` service + media-player target.
 *       - `notify.*`: the `notify.<service>` used for arrival / GPS-lost
 *         notifications, gated by `notify.enabled`.
 */

/** The Supervisor add-on proxy to HA Core's REST API (docs/04 §2). */
const SUPERVISOR_API_BASE = 'http://supervisor/core/api';
const DEFAULT_TTS_SERVICE = 'tts.speak';

export type AnnounceSink = 'browser' | 'ha';

/** Just the settings lookup this module needs; `SettingsService` satisfies it. */
export interface HaSettingsLookup {
  get(key: string): unknown;
}

export interface ResolveHaConfigInput {
  settings?: HaSettingsLookup;
  /** Defaults to `process.env`; overridable for tests. */
  env?: Record<string, string | undefined>;
}

/** Reachability part: how to talk to HA's REST API. `null` when unconfigured. */
export interface HaConnection {
  /** Full REST API base, e.g. `http://homeassistant.local:8123/api` or the
   *  Supervisor proxy `http://supervisor/core/api` -- no trailing slash. */
  apiBase: string;
  /** Bearer token (long-lived token or `SUPERVISOR_TOKEN`). */
  token: string;
}

export interface HaTtsConfig {
  /** `"domain.service"`, default `"tts.speak"`. */
  service: string;
  /** The media_player entity to speak on (required for TTS to do anything). */
  mediaPlayerEntityId?: string;
  /** Optional TTS engine entity (`tts.speak` targets it via `entity_id`). */
  ttsEntityId?: string;
  /** Optional language override, e.g. `"de-DE"`. */
  language?: string;
}

export interface HaNotifyConfig {
  /** Master toggle for arrival / GPS-lost notifications. Default OFF. */
  enabled: boolean;
  /** `"notify.<service>"`, e.g. `"notify.mobile_app_phone"`. */
  service: string;
}

export interface HaConfig {
  connection: HaConnection;
  announceSink: AnnounceSink;
  tts: HaTtsConfig;
  notify: HaNotifyConfig;
}

interface HaSettingsShape {
  base_url?: unknown;
  token?: unknown;
  announce_sink?: unknown;
  tts_service?: unknown;
  tts_media_player?: unknown;
  tts_entity_id?: unknown;
  tts_language?: unknown;
  notify_enabled?: unknown;
  notify_service?: unknown;
}

function readHaSettings(settings?: HaSettingsLookup): HaSettingsShape {
  const raw = settings?.get('ha');
  if (!raw || typeof raw !== 'object') return {};
  return raw as HaSettingsShape;
}

function firstString(...values: unknown[]): string | undefined {
  for (const value of values) {
    if (typeof value === 'string' && value.trim().length > 0) return value.trim();
  }
  return undefined;
}

function stripTrailingSlash(url: string): string {
  return url.replace(/\/+$/, '');
}

/**
 * Resolves how to reach HA's REST API. Explicit `base_url` + `token` win;
 * otherwise the Supervisor proxy is used when `SUPERVISOR_TOKEN` is present.
 * Returns `null` when neither path yields a usable base + token.
 */
export function resolveHaConnection(input: ResolveHaConfigInput = {}): HaConnection | null {
  const env = input.env ?? process.env;
  const settings = readHaSettings(input.settings);

  const explicitBase = firstString(settings.base_url, env.HA_BASE_URL);
  const explicitToken = firstString(settings.token, env.HA_TOKEN);
  if (explicitBase && explicitToken) {
    // A direct HA instance exposes its REST API under `<base>/api`.
    return { apiBase: `${stripTrailingSlash(explicitBase)}/api`, token: explicitToken };
  }

  const supervisorToken = firstString(env.SUPERVISOR_TOKEN);
  if (supervisorToken) {
    return { apiBase: SUPERVISOR_API_BASE, token: supervisorToken };
  }

  return null;
}

function readAnnounceSink(settings: HaSettingsShape): AnnounceSink {
  return settings.announce_sink === 'ha' ? 'ha' : 'browser';
}

/**
 * Full config, or `null` when HA is unreachable/unconfigured (no connection).
 * The announcement sink / notify toggle are still resolved when a connection
 * exists, so a caller can gate behaviour on `announceSink`/`notify.enabled`.
 */
export function resolveHaConfig(input: ResolveHaConfigInput = {}): HaConfig | null {
  const connection = resolveHaConnection(input);
  if (!connection) return null;

  const settings = readHaSettings(input.settings);
  return {
    connection,
    announceSink: readAnnounceSink(settings),
    tts: {
      service: firstString(settings.tts_service) ?? DEFAULT_TTS_SERVICE,
      mediaPlayerEntityId: firstString(settings.tts_media_player),
      ttsEntityId: firstString(settings.tts_entity_id),
      language: firstString(settings.tts_language),
    },
    notify: {
      enabled: settings.notify_enabled === true,
      service: firstString(settings.notify_service) ?? 'notify.notify',
    },
  };
}

export { SUPERVISOR_API_BASE, DEFAULT_TTS_SERVICE };
