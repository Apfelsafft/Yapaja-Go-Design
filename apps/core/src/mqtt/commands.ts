/* eslint-disable no-undef -- `Buffer` is a standard Node global (typed via
 * @types/node); the shared eslint config's `globals` list predates this
 * backend module. Same justification as position/service.ts. */

/**
 * `yapaja/cmd/*` payload parsing (E08-T1, docs/03 §4). Pure functions only --
 * no service access, no MQTT client -- so every validation branch (including
 * the failure paths that must NEVER crash the bridge) is independently
 * unit-testable. `bridge.ts` maps the parsed, typed results onto the actual
 * Core services.
 */
import type { LatLng } from '@yapaja/shared';

export type ParseResult<T> = { ok: true; value: T } | { ok: false; error: string };

function parseJson(raw: Buffer): unknown {
  try {
    return JSON.parse(raw.toString('utf8'));
  } catch {
    return undefined;
  }
}

/** `request_id` passthrough (docs/03 §4: "wird durchgereicht, wenn im
 *  Kommando enthalten") -- present on any JSON-object command payload. */
export function extractRequestId(payload: unknown): string | undefined {
  if (payload && typeof payload === 'object') {
    const rid = (payload as Record<string, unknown>).request_id;
    if (typeof rid === 'string') return rid;
  }
  return undefined;
}

// --- yapaja/cmd/destination --------------------------------------------------

export interface ParsedDestinationCommand {
  latlng?: LatLng;
  query?: string;
  autostart: boolean;
  requestId?: string;
}

/** `{query?: string, lat?: number, lon?: number, autostart?: bool}`. */
export function parseDestinationCommand(raw: Buffer): ParseResult<ParsedDestinationCommand> {
  const payload = parseJson(raw);
  if (!payload || typeof payload !== 'object') {
    return { ok: false, error: 'cmd/destination payload must be a JSON object' };
  }
  const obj = payload as Record<string, unknown>;
  const requestId = extractRequestId(obj);

  const hasLatLon = typeof obj.lat === 'number' && typeof obj.lon === 'number';
  const query = typeof obj.query === 'string' ? obj.query.trim() : undefined;
  if (!hasLatLon && !query) {
    return { ok: false, error: 'cmd/destination requires "query" or "lat"+"lon"' };
  }

  const value: ParsedDestinationCommand = { autostart: obj.autostart === true, requestId };
  if (hasLatLon) value.latlng = { lat: obj.lat as number, lon: obj.lon as number };
  if (query) value.query = query;
  return { ok: true, value };
}

// --- yapaja/cmd/navigation ---------------------------------------------------

const NAV_ACTIONS = ['start', 'pause', 'resume', 'stop'] as const;
export type NavigationCommandAction = (typeof NAV_ACTIONS)[number];

export interface ParsedNavigationCommand {
  action: NavigationCommandAction;
  requestId?: string;
}

function isNavigationAction(value: string): value is NavigationCommandAction {
  return (NAV_ACTIONS as readonly string[]).includes(value);
}

/**
 * `"start" | "pause" | "resume" | "stop"` -- docs/03 §4 documents this as a
 * bare string payload (not a JSON object). Accepts that literally (both the
 * raw unquoted text `start` and the JSON-quoted string `"start"`), and ALSO
 * the more HA-`rest_command`-friendly `{action, request_id?}` object form so
 * a `request_id` can still be threaded through this command.
 */
export function parseNavigationCommand(raw: Buffer): ParseResult<ParsedNavigationCommand> {
  const text = raw.toString('utf8').trim();
  let candidate = text;
  let requestId: string | undefined;

  try {
    const parsed: unknown = JSON.parse(text);
    if (typeof parsed === 'string') {
      candidate = parsed;
    } else if (parsed && typeof parsed === 'object') {
      const obj = parsed as Record<string, unknown>;
      if (typeof obj.action === 'string') candidate = obj.action;
      requestId = extractRequestId(obj);
    }
  } catch {
    // Not JSON at all -- the raw text itself is taken as the bare action,
    // matching the docs/03 §4 literal payload format.
  }

  if (isNavigationAction(candidate)) {
    return { ok: true, value: { action: candidate, requestId } };
  }
  return { ok: false, error: `Unknown navigation action "${candidate}"` };
}

// --- yapaja/cmd/profile -------------------------------------------------------

export interface ParsedProfileCommand {
  id?: string;
  name?: string;
  requestId?: string;
}

/** `{id}` or `{name}`. */
export function parseProfileCommand(raw: Buffer): ParseResult<ParsedProfileCommand> {
  const payload = parseJson(raw);
  if (!payload || typeof payload !== 'object') {
    return { ok: false, error: 'cmd/profile payload must be a JSON object' };
  }
  const obj = payload as Record<string, unknown>;
  const id = typeof obj.id === 'string' ? obj.id : undefined;
  const name = typeof obj.name === 'string' ? obj.name : undefined;
  if (!id && !name) {
    return { ok: false, error: 'cmd/profile requires "id" or "name"' };
  }
  return { ok: true, value: { id, name, requestId: extractRequestId(obj) } };
}

// --- yapaja/cmd/favorite ------------------------------------------------------

export interface ParsedFavoriteCommand {
  name: string;
  requestId?: string;
}

/** `{name}`. */
export function parseFavoriteCommand(raw: Buffer): ParseResult<ParsedFavoriteCommand> {
  const payload = parseJson(raw);
  if (!payload || typeof payload !== 'object') {
    return { ok: false, error: 'cmd/favorite payload must be a JSON object' };
  }
  const obj = payload as Record<string, unknown>;
  const name = typeof obj.name === 'string' ? obj.name.trim() : '';
  if (!name) {
    return { ok: false, error: 'cmd/favorite requires "name"' };
  }
  return { ok: true, value: { name, requestId: extractRequestId(obj) } };
}
