/**
 * THE `security` EVENT CHANNEL (E09-T6, Wargame W-10, docs/07 §7).
 *
 * Every add-on sandbox boundary in this Core already REFUSES what it must
 * refuse (scope matrix, egress allow-list, storage namespace, tarball
 * extractor, token invalidation, iframe bridge). What was missing until this
 * task is the second half of the acceptance criterion: a refusal must also be
 * OBSERVABLE as a first-class `security` event, not just a pino line buried in
 * the process log.
 *
 * This module is that channel. It is deliberately tiny and dependency-free
 * (only the bus type) so every enforcement point can record into it without
 * creating an import cycle or needing a constructor rewrite.
 *
 * THREE OUTPUTS PER VIOLATION, ALWAYS:
 *   1. a bounded in-memory ring buffer (the last {@link MAX_SECURITY_EVENTS}),
 *      readable via `GET /api/v1/security/events` (Core-token guarded),
 *   2. a bus publish on `event/security_violation` (so WS/MQTT subscribers and
 *      the UI can react live),
 *   3. a `warn`-level structured log line.
 *
 * SECRETS NEVER ENTER THIS LOG. `detail` is a short human-readable string
 * assembled by the enforcement point from non-secret facts (method, path,
 * topic, host, tarball entry name). Tokens, token hashes, passwords and
 * request bodies are NEVER passed in, and {@link redactDetail} additionally
 * strips anything that looks like a bearer token as a last line of defence --
 * belt and braces, because a leak here would turn an audit log into a
 * credential store.
 */

import type { EventBus } from '../bus/index.js';

/**
 * THE stable, machine-readable vector ids. This single exported list is what
 * the producers (enforcement points) and the consumer (the E09-T6 security
 * suite) both import, so the two can never drift: adding a vector here is the
 * one edit that makes it assertable, and a typo fails to compile.
 *
 * Naming: `<surface>.<what was attempted>`.
 */
export const SECURITY_VECTORS = [
  // --- frontend bridge (apps/web/src/addons/bridge.ts), host-detected -----
  /** A bridge `call` for a method that does not exist at all. */
  'bridge.unknown_method',
  /** A bridge `call` for a method whose scope the add-on was not granted. */
  'bridge.scope_denied',
  /** A postMessage whose `event.source` is not the pinned iframe window. */
  'bridge.source_spoofed',
  /** `events.publish` (bridge) or `POST /addons/:id/events` (REST) or a WS
   *  `subscribe` targeting a topic outside `addon/{id}/*`. */
  'events.foreign_topic',

  // --- Core scope matrix (apps/core/src/addons/scopeMatrix.ts) ------------
  /** An add-on principal hit a route the default-deny matrix does not grant
   *  it (unknown route, or a granted route without the required scope). */
  'core.scope_denied',
  /** An add-on tried to ACTIVATE navigation/routing instead of proposing it
   *  (`/api/v1/navigation/*` without `nav.control`) -- W-10's core rule that
   *  an add-on may never steer the vehicle without a user confirm. */
  'route.activate_without_confirm',

  // --- egress proxy (apps/core/src/addons/proxy.ts) -----------------------
  /** Outbound request to a host the manifest never declared via
   *  `net.fetch:<host>` (including a redirect hop to such a host). */
  'egress.host_not_declared',

  // --- storage (apps/core/src/addons/storage{Service,Routes}.ts) ----------
  /** An add-on addressed a storage namespace or key outside its own. */
  'storage.foreign_namespace',

  // --- service runtime (apps/core/src/addons/service-host.ts) -------------
  /** The add-on child process was denied a filesystem access outside its
   *  granted read/write roots by Node's permission model. */
  'fs.outside_datadir',

  // --- scoped tokens (apps/core/src/addons/tokens.ts) ---------------------
  /** A token that was revoked (disable/uninstall/rotate) or whose add-on is
   *  no longer enabled was presented again. */
  'token.replay_after_disable',

  // --- install pipeline (apps/core/src/addons/{extract,installService}.ts)-
  /** Tarball entry escaping the destination directory (`../`, absolute). */
  'tarball.path_traversal',
  /** Tarball entry is a symlink or hardlink. */
  'tarball.symlink',
  /** Tarball exceeded the compressed or uncompressed size cap. */
  'tarball.zip_bomb',

  // --- sandboxed add-on UI, self-reported through the trusted host --------
  /** The add-on UI tried to reach the parent DOM / cookies / localStorage.
   *  See the "SELF-REPORTED VECTORS" note in `apps/core/src/security/routes.ts`. */
  'ui.parent_dom_access',
  /** The add-on UI tried to `fetch()`/XHR/WebSocket a foreign host. */
  'ui.foreign_host_fetch',
] as const;

/** A vector id from {@link SECURITY_VECTORS}. */
export type SecurityVector = (typeof SECURITY_VECTORS)[number];

const VECTOR_SET: ReadonlySet<string> = new Set<string>(SECURITY_VECTORS);

/** Type guard for an untrusted (e.g. request-body) vector id. */
export function isSecurityVector(value: unknown): value is SecurityVector {
  return typeof value === 'string' && VECTOR_SET.has(value);
}

/**
 * One recorded violation. This is BOTH the ring-buffer entry, the
 * `event/security_violation` bus payload, and the `GET /security/events`
 * response element -- one shape, so a consumer written against any of the
 * three works against all of them.
 */
export interface SecurityViolation {
  /** Stable machine-readable id -- what the suite asserts on. */
  vector: SecurityVector;
  /** The add-on the attempt is attributed to, or `null` when the attempt
   *  could not be attributed (e.g. an anonymous install upload). */
  addonId: string | null;
  /** Short human-readable context. NEVER a token or any other secret. */
  detail: string;
  /** ISO 8601 UTC timestamp of the refusal. */
  at: string;
}

/** How many violations the ring buffer keeps (oldest are dropped). */
export const MAX_SECURITY_EVENTS = 500;

/** Longest `detail` we store; anything longer is truncated with an ellipsis. */
const MAX_DETAIL_LENGTH = 400;

/** Just the logging surface this module needs; fastify's pino logger and a
 *  test double both satisfy it structurally. */
export interface SecurityLogger {
  warn(meta: Record<string, unknown>, msg: string): void;
}

/**
 * Last-resort scrub of anything token-shaped out of a detail string. The
 * enforcement points are already written to never pass a secret; this exists
 * so a future careless caller cannot turn the audit log into a credential
 * store. Also collapses whitespace and truncates.
 *
 * It deliberately errs towards OVER-redaction (a detail that merely contains
 * the word "secret" loses its tail): an over-scrubbed audit line is a cosmetic
 * problem, an under-scrubbed one is a credential leak. It is a backstop, not
 * the guarantee -- the guarantee is that enforcement points never pass a
 * secret in the first place.
 */
export function redactDetail(detail: string): string {
  const scrubbed = detail
    // `Bearer <token>` / `token=<token>` / `Authorization: …` in any casing.
    .replace(/\b(bearer|token|authorization|password|secret|api[_-]?key)\b\s*[:=]?\s*\S+/gi, '$1=<redacted>')
    .replace(/\s+/g, ' ')
    .trim();
  return scrubbed.length > MAX_DETAIL_LENGTH ? `${scrubbed.slice(0, MAX_DETAIL_LENGTH - 1)}…` : scrubbed;
}

export interface SecurityEventLogOptions {
  bus?: EventBus;
  logger?: SecurityLogger;
  maxEntries?: number;
}

/**
 * The bounded recorder. One instance per Core process (see
 * {@link securityEventLog}); the class itself is exported so unit tests can
 * use a throwaway instance instead of the shared singleton.
 */
export class SecurityEventLog {
  private entries: SecurityViolation[] = [];
  private bus?: EventBus;
  private logger?: SecurityLogger;
  private readonly maxEntries: number;

  constructor(opts: SecurityEventLogOptions = {}) {
    this.bus = opts.bus;
    this.logger = opts.logger;
    this.maxEntries = opts.maxEntries ?? MAX_SECURITY_EVENTS;
  }

  /**
   * Attaches the bus + logger. Called once from `buildServer()`; recording
   * works (into the ring buffer) even before this runs, so an enforcement
   * point that fires during startup is never silently lost.
   */
  configure(opts: { bus?: EventBus; logger?: SecurityLogger }): void {
    if (opts.bus) this.bus = opts.bus;
    if (opts.logger) this.logger = opts.logger;
  }

  /**
   * Records ONE refused attempt. Never throws -- a failure to log a refusal
   * must never turn into a failure to REFUSE, so every side effect here is
   * individually guarded.
   */
  record(vector: SecurityVector, addonId: string | null, detail: string): SecurityViolation {
    const violation: SecurityViolation = {
      vector,
      addonId: typeof addonId === 'string' && addonId !== '' ? addonId : null,
      detail: redactDetail(detail),
      at: new Date().toISOString(),
    };

    this.entries.push(violation);
    if (this.entries.length > this.maxEntries) {
      this.entries.splice(0, this.entries.length - this.maxEntries);
    }

    try {
      this.logger?.warn(
        { vector: violation.vector, addon_id: violation.addonId, detail: violation.detail },
        'security violation blocked',
      );
    } catch {
      /* a broken logger must never break enforcement */
    }
    try {
      this.bus?.publish('event/security_violation', violation);
    } catch {
      /* a throwing bus subscriber must never break enforcement */
    }
    return violation;
  }

  /** Newest-last snapshot, optionally filtered by vector / add-on id. */
  list(filter: { vector?: string; addonId?: string; limit?: number } = {}): SecurityViolation[] {
    let out = this.entries;
    if (filter.vector !== undefined) out = out.filter((e) => e.vector === filter.vector);
    if (filter.addonId !== undefined) out = out.filter((e) => e.addonId === filter.addonId);
    if (filter.limit !== undefined && filter.limit >= 0 && out.length > filter.limit) {
      out = out.slice(out.length - filter.limit);
    }
    return [...out];
  }

  /** Number of retained entries (before filtering). */
  get size(): number {
    return this.entries.length;
  }

  /** Test/maintenance helper; never exposed over HTTP. */
  clear(): void {
    this.entries = [];
  }
}

/**
 * The process-wide recorder every enforcement point writes into. A module
 * singleton rather than a constructor-injected dependency ON PURPOSE: the
 * enforcement points are spread across the auth hook, the WS plugin, the
 * egress proxy, the storage service, the install pipeline, the token service
 * and the service host, and threading a recorder through all of their
 * constructors would be a large refactor of security-critical code for zero
 * behavioural gain. `configure()` wires the bus/logger once from
 * `buildServer()`.
 */
export const securityEventLog = new SecurityEventLog();
