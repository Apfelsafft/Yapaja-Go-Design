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
 */

import { SettingsService } from '../settings/service.js';
import { ADDON_ID_RE } from './paths.js';

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
    throw new AddonStorageError('INVALID_ID', `"${addonId}" is not a valid add-on id`);
  }
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
    return this.readMap(addonId)[key];
  }

  /** Upserts `key = value` within `addonId`'s OWN namespace. */
  set(addonId: string, key: string, value: unknown): void {
    assertValidId(addonId);
    const map = this.readMap(addonId);
    map[key] = value;
    this.settings.patch({ [namespaceKey(addonId)]: map });
  }

  /** Removes `key` from `addonId`'s namespace. Idempotent. */
  delete(addonId: string, key: string): void {
    assertValidId(addonId);
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
