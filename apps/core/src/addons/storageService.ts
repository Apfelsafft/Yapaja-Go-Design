/**
 * Server-side, NAMESPACE-ENFORCED key/value storage for the `storage.own`
 * scope (E09-T2, docs/05 §2/§3). Each add-on gets its OWN isolated key space;
 * there is no API surface through which one add-on could name another add-on's
 * keys, because the add-on id is a PATH PARAMETER validated against
 * `ADDON_ID_RE` and every value is stored under a per-add-on reserved settings
 * key `addon.storage.{id}` -- the id is the namespace, applied here on the
 * server, not trusted from any client-supplied key string.
 *
 * Persistence rides on the existing `settings` table (via `SettingsService`)
 * rather than a new migration: the reserved `addon.storage.{id}` keys are
 * inert to every other consumer (the web app's settings reconciliation only
 * ever reads its own `layouts`/config keys and ignores unknown ones). This
 * keeps E09-T2 additive -- no schema change -- while still giving each add-on
 * a durable, isolated KV store.
 *
 * E09-T6 (W-10) added KEY-SHAPE validation on top ({@link isSafeStorageKey}):
 * the namespace was already unforgeable, but a path-shaped key (`../other`,
 * `/etc/passwd`) used to be silently ACCEPTED as an ordinary (if odd) map key
 * instead of being refused. It is now rejected with `INVALID_KEY` and recorded
 * as a `storage.foreign_namespace` security event, so an escape ATTEMPT is
 * observable rather than a silent no-op.
 */

import { SettingsService } from '../settings/service.js';
import { ADDON_ID_RE } from './paths.js';
import { securityEventLog } from '../security/securityEvents.js';

/** Just the settings ops this service needs; `SettingsService` satisfies it
 *  structurally, and a test can inject an in-memory fake. */
export interface AddonStorageSettings {
  get(key: string): unknown;
  patch(values: Record<string, unknown>): Record<string, unknown>;
}

export class AddonStorageError extends Error {
  code: string;
  constructor(code: string, message: string) {
    super(message);
    this.code = code;
    this.name = 'AddonStorageError';
  }
}

/** Reserved settings key holding ONE add-on's entire KV map. */
function namespaceKey(addonId: string): string {
  return `addon.storage.${addonId}`;
}

function assertValidId(addonId: string): void {
  if (!ADDON_ID_RE.test(addonId)) {
    securityEventLog.record(
      'storage.foreign_namespace',
      null,
      `refused storage access for the unsafe add-on id "${addonId}"`,
    );
    throw new AddonStorageError('INVALID_ID', `"${addonId}" is not a valid add-on id`);
  }
}

/** Longest accepted key. Keeps one add-on from bloating the settings row. */
const MAX_KEY_LENGTH = 256;

/**
 * E09-T6 (W-10): key SHAPE validation.
 *
 * The namespace itself was already unforgeable before this task -- a key is a
 * JSON object member inside the per-add-on `addon.storage.{id}` map, so even a
 * key literally spelled `../other/secret` could never have reached another
 * add-on's data. What was missing is that such an attempt was silently
 * ACCEPTED (stored under a funny-looking key) instead of being refused and
 * recorded. Path-shaped keys have no legitimate use -- the reference add-ons
 * use `state`, `index`, `command`, `track:<id>` -- so they are now rejected,
 * which turns "escape attempt" into an observable, logged refusal instead of a
 * silent no-op.
 *
 * Rejected: empty/whitespace-only, anything containing a path separator
 * (`/`, `\`), any `..` sequence (incl. what percent-decoding produced --
 * fastify decodes `%2e%2e` before the handler sees it), control characters,
 * and anything over {@link MAX_KEY_LENGTH} characters.
 */
export function isSafeStorageKey(key: unknown): key is string {
  if (typeof key !== 'string') return false;
  if (key.trim() === '' || key.length > MAX_KEY_LENGTH) return false;
  if (key.includes('/') || key.includes('\\')) return false;
  if (key.includes('..')) return false;
  // eslint-disable-next-line no-control-regex -- deliberately matching C0/DEL.
  if (/[\u0000-\u001f\u007f]/.test(key)) return false;
  return true;
}

function assertValidKey(addonId: string, key: string): void {
  if (isSafeStorageKey(key)) return;
  securityEventLog.record(
    'storage.foreign_namespace',
    addonId,
    `refused storage key outside the add-on's own namespace: "${String(key).slice(0, 120)}"`,
  );
  throw new AddonStorageError(
    'INVALID_KEY',
    'A storage key must not be empty and must not contain "/", "\\", ".." or control characters',
  );
}

export class AddonStorageService {
  constructor(private readonly settings: AddonStorageSettings = new SettingsService()) {}

  private readMap(addonId: string): Record<string, unknown> {
    const raw = this.settings.get(namespaceKey(addonId));
    if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
      return raw as Record<string, unknown>;
    }
    return {};
  }

  /** Returns the value for `key`, or `undefined` if unset. Scoped to `addonId`. */
  get(addonId: string, key: string): unknown {
    assertValidId(addonId);
    assertValidKey(addonId, key);
    return this.readMap(addonId)[key];
  }

  /** Upserts `key = value` within `addonId`'s OWN namespace. */
  set(addonId: string, key: string, value: unknown): void {
    assertValidId(addonId);
    assertValidKey(addonId, key);
    const map = this.readMap(addonId);
    map[key] = value;
    this.settings.patch({ [namespaceKey(addonId)]: map });
  }

  /** Removes `key` from `addonId`'s namespace. Idempotent. */
  delete(addonId: string, key: string): void {
    assertValidId(addonId);
    assertValidKey(addonId, key);
    const map = this.readMap(addonId);
    if (key in map) {
      delete map[key];
      this.settings.patch({ [namespaceKey(addonId)]: map });
    }
  }

  /** Wipes an add-on's entire KV namespace (used on uninstall, defensively). */
  clear(addonId: string): void {
    assertValidId(addonId);
    this.settings.patch({ [namespaceKey(addonId)]: {} });
  }
}
