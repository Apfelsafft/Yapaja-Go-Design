/* eslint-disable no-undef -- `Buffer` is a standard Node global (typed via
 * @types/node); same justification as the rest of the backend modules. */

/**
 * Bearer-token authentication for the standalone Core API (E08-T3, docs/04 §2).
 *
 * SECURITY POSTURE -- when is auth ENFORCED?
 * -----------------------------------------
 * Yapaja Go is an OFFLINE motorhome device that normally runs on a trusted
 * LAN (or as a Home-Assistant add-on behind HA's own ingress auth). A fresh
 * install ships with NO token, and we deliberately keep the API OPEN in that
 * state so the device is never "bricked" before an operator has had a chance
 * to configure anything (and so the bundled web UI + `/ws/v1`, which cannot
 * add an `Authorization` header from a browser fetch by default, keep working
 * out of the box). Auth becomes ENFORCED the moment a token is configured:
 *
 *   1. env `API_AUTH_TOKEN` -- takes PRECEDENCE (deployment-level override), or
 *   2. the Settings key `auth.token` (generated/rotated via the Settings API).
 *
 * `INGRESS_MODE=1` DISABLES auth entirely regardless of any configured token:
 * Home Assistant's ingress has already authenticated the user and proxies the
 * request over a trusted interface, so a second token would be redundant (and
 * the browser inside the ingress iframe can't set one anyway).
 *
 * The token is compared in CONSTANT TIME (`crypto.timingSafeEqual`, length
 * guarded first) so a caller can't recover it via response-timing analysis.
 * The token value is NEVER logged (see `authRoutes.ts` / `plugin.ts`).
 *
 * Trade-off, stated plainly: the default-open posture means an operator who
 * exposes the Core to an untrusted network WITHOUT setting a token has no
 * protection. That is the correct default for an offline LAN appliance (usability
 * over a lock that strands the first-run user), and the remedy is one setting
 * away -- operators are documented to set `API_AUTH_TOKEN` or rotate a token
 * in Settings before exposing the device.
 */

import { timingSafeEqual } from 'node:crypto';

/** Settings key holding the (optional) API bearer token. */
export const AUTH_TOKEN_SETTINGS_KEY = 'auth.token';

/** Just the settings lookup this module needs; the real `SettingsService`
 *  satisfies it structurally (keeps the guard trivially testable). */
export interface AuthSettingsLookup {
  get(key: string): unknown;
}

export interface AuthGuardOptions {
  settings?: AuthSettingsLookup;
  /** Defaults to `process.env`; overridable for tests. */
  env?: Record<string, string | undefined>;
}

/** `'1'`/`'true'` (case-insensitive) enable ingress mode; anything else does not. */
function isTruthyEnv(value: string | undefined): boolean {
  if (value === undefined) return false;
  const normalized = value.trim().toLowerCase();
  return normalized === '1' || normalized === 'true';
}

export class AuthGuard {
  private readonly settings?: AuthSettingsLookup;
  private readonly env: Record<string, string | undefined>;

  constructor(opts: AuthGuardOptions = {}) {
    this.settings = opts.settings;
    this.env = opts.env ?? process.env;
  }

  /** HA ingress already authenticated the user -> auth is bypassed. */
  isIngressMode(): boolean {
    return isTruthyEnv(this.env.INGRESS_MODE);
  }

  /**
   * The currently configured token (env wins over settings), read LIVE on
   * every call so a rotation via the Settings API takes effect immediately
   * without a restart. `null` when no token is configured anywhere.
   */
  getConfiguredToken(): string | null {
    const fromEnv = this.env.API_AUTH_TOKEN;
    if (typeof fromEnv === 'string' && fromEnv.length > 0) return fromEnv;
    const fromSettings = this.settings?.get(AUTH_TOKEN_SETTINGS_KEY);
    if (typeof fromSettings === 'string' && fromSettings.length > 0) return fromSettings;
    return null;
  }

  /** Auth is enforced only when NOT in ingress mode AND a token is configured. */
  isEnforced(): boolean {
    if (this.isIngressMode()) return false;
    return this.getConfiguredToken() !== null;
  }

  /**
   * Constant-time verification of a provided token against the configured one.
   * Returns `true` when auth is not enforced (open posture / ingress). When
   * enforced, a missing/empty/wrong-length/mismatched token returns `false`.
   */
  verify(provided: string | null | undefined): boolean {
    if (!this.isEnforced()) return true;
    const expected = this.getConfiguredToken();
    if (expected === null) return true; // unreachable given isEnforced(), defensive
    if (typeof provided !== 'string' || provided.length === 0) return false;
    const a = Buffer.from(provided, 'utf8');
    const b = Buffer.from(expected, 'utf8');
    // Length guard FIRST: `timingSafeEqual` throws on unequal lengths. This
    // leaks only the token LENGTH, never its contents or a per-byte match
    // position -- an accepted, standard trade-off.
    if (a.length !== b.length) return false;
    return timingSafeEqual(a, b);
  }
}

/** Extracts the token from an `Authorization: Bearer <token>` header. */
export function parseBearerToken(header: string | string[] | undefined): string | null {
  if (typeof header !== 'string') return null;
  const match = /^Bearer\s+(.+)$/i.exec(header.trim());
  return match ? match[1].trim() : null;
}

/** Reads a `token` value out of a raw `Cookie` header, if present. */
export function parseCookieToken(cookieHeader: string | string[] | undefined): string | null {
  if (typeof cookieHeader !== 'string') return null;
  for (const part of cookieHeader.split(';')) {
    const eq = part.indexOf('=');
    if (eq === -1) continue;
    const name = part.slice(0, eq).trim();
    if (name === 'token') {
      return decodeURIComponent(part.slice(eq + 1).trim());
    }
  }
  return null;
}

/**
 * Extracts a token for a `/ws/v1` upgrade: browsers can't set an
 * `Authorization` header on a WebSocket, so the token comes from the
 * `?token=` query param (primary) or a `token` cookie (fallback).
 */
export function extractWsToken(
  query: unknown,
  cookieHeader: string | string[] | undefined,
): string | null {
  if (query && typeof query === 'object') {
    const q = (query as Record<string, unknown>).token;
    if (typeof q === 'string' && q.length > 0) return q;
  }
  return parseCookieToken(cookieHeader);
}
