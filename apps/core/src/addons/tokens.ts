/**
 * Per-add-on SCOPED API tokens (E09-T3, docs/05 §1B/§2, Wargame W-14).
 *
 * An add-on -- whether a Core-spawned Node service (`runtime: node18|node20`)
 * or an external container (`runtime: external`) -- talks to the Core over
 * exactly the same public REST/WS API as any other client, but with a token
 * that identifies it as THAT add-on and carries only the scopes its manifest
 * declared. There are no internal imports, no direct SQLite access, no
 * privileged side channel (docs/05 §1B).
 *
 * WHAT IS STORED
 * --------------
 * Never the token. `issue()` returns 32 cryptographically random bytes as
 * base64url ONCE (to the caller: the spawner, which puts it in the child's
 * `YAPAJA_TOKEN`, or the "show token" API for an external add-on) and persists
 * only `sha256(token)`. `authenticate()` hashes the presented token and looks
 * the digest up. A database copy therefore yields no usable credential, and
 * the token never appears in a log line (see `logging` note in
 * `auth/authGuard.ts` -- same posture).
 *
 * INVALIDATION IS IMMEDIATE (< 1 s, and in fact synchronous)
 * ----------------------------------------------------------
 * Two independent mechanisms, both live on every single request:
 *  1. `revoke()` DELETEs the row -- called by the service host on disable,
 *     uninstall, and watchdog auto-disable.
 *  2. `authenticate()` re-reads the add-on's `enabled` flag from the `addons`
 *     table on every call and refuses the token when the add-on is disabled or
 *     gone. `enabled` is the single source of truth (E09-T1), so even a revoke
 *     that never ran (crash between DB write and revoke) cannot leave a
 *     working token behind.
 * Nothing is cached in memory, so there is no window in which a stale token
 * still works.
 *
 * SCOPES ARE INTERSECTED, NOT TRUSTED
 * -----------------------------------
 * The granted set stored at issuance is intersected with the add-on's CURRENT
 * manifest permissions on every authentication. An update that drops a
 * permission therefore narrows the live token immediately, and a token can
 * never widen beyond what the operator confirmed at install time.
 */

import type Database from 'better-sqlite3';
import { createHash, randomBytes } from 'node:crypto';
import { Buffer } from 'node:buffer';
import { getDb } from '../db/index.js';
import { AddonRepository } from './repository.js';
import {
  authorizeAddonRequest,
  authorizeAddonTopic,
  type AddonAuthzDecision,
  type AddonPrincipal,
  type WsTopicDecision,
} from './scopeMatrix.js';

declare module 'fastify' {
  interface FastifyRequest {
    /** Set by the auth hook when the bearer token is a scoped ADD-ON token.
     *  Absent for the ordinary Core API token / the open posture. */
    addonPrincipal?: AddonPrincipal;
  }
}

export interface AddonTokenRow {
  addon_id: string;
  token_hash: string;
  scopes: string;
  created_at: string;
}

/** Metadata about a live token -- everything EXCEPT the token itself. */
export interface AddonTokenInfo {
  addonId: string;
  scopes: string[];
  createdAt: string;
}

/** Number of random bytes behind a token (256 bit, same as the Core API token). */
const TOKEN_BYTES = 32;

export function hashAddonToken(raw: string): string {
  return createHash('sha256').update(Buffer.from(raw, 'utf8')).digest('hex');
}

export class AddonTokenService {
  private readonly db: Database.Database;
  private readonly repository: AddonRepository;

  constructor(opts: { db?: Database.Database; repository?: AddonRepository } = {}) {
    this.db = opts.db ?? getDb();
    this.repository = opts.repository ?? new AddonRepository(this.db);
  }

  /**
   * Mints a fresh token for `addonId`, granting exactly `scopes` (the add-on's
   * manifest `permissions`). ROTATES: any previously issued token for the same
   * add-on stops working the instant this returns. The raw token is returned
   * here and nowhere else, ever.
   */
  issue(addonId: string, scopes: readonly string[]): string {
    const raw = randomBytes(TOKEN_BYTES).toString('base64url');
    const now = new Date().toISOString();
    this.db
      .prepare(
        `INSERT INTO addon_tokens (addon_id, token_hash, scopes, created_at)
         VALUES (?, ?, ?, ?)
         ON CONFLICT(addon_id) DO UPDATE SET
           token_hash = excluded.token_hash,
           scopes = excluded.scopes,
           created_at = excluded.created_at`,
      )
      .run(addonId, hashAddonToken(raw), JSON.stringify([...scopes]), now);
    return raw;
  }

  /** Drops the add-on's token. Idempotent; returns true if one existed. */
  revoke(addonId: string): boolean {
    return this.db.prepare(`DELETE FROM addon_tokens WHERE addon_id = ?`).run(addonId).changes > 0;
  }

  /** Token metadata for the UI ("this add-on has a token, issued at ..."). */
  getInfo(addonId: string): AddonTokenInfo | null {
    const row = this.db
      .prepare(`SELECT * FROM addon_tokens WHERE addon_id = ?`)
      .get(addonId) as AddonTokenRow | undefined;
    if (!row) return null;
    return { addonId: row.addon_id, scopes: parseScopes(row.scopes), createdAt: row.created_at };
  }

  /**
   * Resolves a presented bearer/WS token to an add-on principal, or `null` if
   * it is not an add-on token (the caller then falls back to the ordinary
   * Core-token path -- an add-on token is an ADDITIONAL principal type, it
   * never replaces or weakens E08-T3's guard).
   *
   * Returns `null` -- i.e. the token is dead -- when the add-on is disabled,
   * uninstalled, or its row vanished. This is the "< 1 s invalidation"
   * guarantee, implemented as "checked live, every time".
   */
  authenticate(raw: string | null | undefined): AddonPrincipal | null {
    if (typeof raw !== 'string' || raw.length === 0) return null;
    const row = this.db
      .prepare(`SELECT * FROM addon_tokens WHERE token_hash = ?`)
      .get(hashAddonToken(raw)) as AddonTokenRow | undefined;
    if (!row) return null;

    const record = this.repository.getById(row.addon_id);
    // Uninstalled, or DISABLED -> the token is dead this instant.
    if (!record || !record.enabled) return null;

    const manifestPermissions = new Set(record.manifest.permissions ?? []);
    const granted = parseScopes(row.scopes).filter((s) => manifestPermissions.has(s));
    const netFetchDeclarations = granted
      .filter((s) => s.startsWith('net.fetch:'))
      .map((s) => s.slice('net.fetch:'.length));

    return {
      addonId: row.addon_id,
      scopes: new Set(granted),
      netFetchDeclarations,
    };
  }
}

function parseScopes(json: string): string[] {
  try {
    const parsed: unknown = JSON.parse(json);
    return Array.isArray(parsed) ? parsed.filter((s): s is string => typeof s === 'string') : [];
  } catch {
    return [];
  }
}

/**
 * The structural contract `auth/plugin.ts` and `bus/ws.ts` consume. Keeping it
 * structural means the auth layer has no import edge into the add-on module
 * (and stays trivially testable with a fake).
 */
export interface AddonAuthenticator {
  authenticate(token: string | null | undefined): AddonPrincipal | null;
  authorizeRequest(principal: AddonPrincipal, method: string, path: string): AddonAuthzDecision;
  authorizeTopic(principal: AddonPrincipal, pattern: string): WsTopicDecision;
}

/** Wires {@link AddonTokenService} together with the scope matrix. */
export class AddonAuthService implements AddonAuthenticator {
  constructor(private readonly tokens: AddonTokenService) {}

  authenticate(token: string | null | undefined): AddonPrincipal | null {
    return this.tokens.authenticate(token);
  }

  authorizeRequest(principal: AddonPrincipal, method: string, path: string): AddonAuthzDecision {
    return authorizeAddonRequest(principal, method, path);
  }

  authorizeTopic(principal: AddonPrincipal, pattern: string): WsTopicDecision {
    return authorizeAddonTopic(principal, pattern);
  }
}

export type { AddonPrincipal } from './scopeMatrix.js';
