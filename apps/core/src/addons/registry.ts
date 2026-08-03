/**
 * Registry client (E09-T7, docs/05 §5, Wargame W-11/W-13): loads, STRICTLY
 * validates, and locally caches the public add-on catalog `index.json` a
 * `yapaja-addons-registry` Git repo publishes (statically hostable, e.g.
 * GitHub Pages/raw -- "funktioniert mit sporadischem Internet").
 *
 * THREAT MODEL: `index.json` is FULLY UNTRUSTED remote input, same class of
 * risk as an add-on tarball. This module never trusts a single field's shape
 * without checking it, and one malformed/malicious entry (wrong types,
 * implausible sizes, a bad sha256, a duplicate id) must never take down the
 * whole catalog. DECISION (documented once here, applied consistently by
 * {@link validateEntry}/{@link validateRegistryIndex}): a bad ENTRY is
 * DROPPED, the rest of the index is still served -- exactly the precedent
 * `map/regions/catalog.ts#loadCatalog` already set for the (structurally
 * simpler, but same "external JSON list, never crash the store over one bad
 * row" trust model) map-regions catalog. Only a bad ROOT SHAPE (not a JSON
 * array at all) rejects the whole index, because there is nothing safe to
 * iterate.
 *
 * `sha256` enforcement itself does NOT happen here -- this module only
 * validates that the field is *present and well-formed* (64 lowercase-hex
 * chars) so a caller always has a real digest to hand to
 * `InstallService.beginInstallFromUrl()`, which is the ONE place that
 * actually verifies the downloaded tarball's bytes against it (see
 * `installService.ts`'s module doc). Re-implementing that check here would
 * be exactly the kind of duplication the task spec warns against.
 *
 * `signature` is a RESERVED field (docs/05 §5: "Signierung (minisign) ist ab
 * v1.1 vorgesehen, Feld `signature` im Index von Anfang an reserviert"): its
 * SHAPE is validated (optional string or null) so a registry author can
 * start populating it now, but its VALUE IS NEVER VERIFIED by this module or
 * by the install pipeline. An entry with a `signature` is not one bit more
 * trusted than one without -- do not treat its presence as any kind of
 * guarantee until a future task actually implements minisign verification.
 */

import { URL } from 'node:url';
import { Buffer } from 'node:buffer';
import { ADDON_ID_RE } from './paths.js';
import { ADDON_PERMISSION_SCOPES, ADDON_NET_FETCH_PATTERN, isValidSemver, isValidRange } from '@yapaja/shared';
import { downloadTarball } from './download.js';
import { SettingsService } from '../settings/service.js';

/** Official registry repo's raw `index.json` -- the built-in default,
 *  overridable per docs/05 §5 ("Registry-Client: index.json von
 *  konfigurierbarer URL laden"). Not a real, dereferenceable URL in this
 *  repo's test/dev environment on purpose -- exactly like `map/regions`'s
 *  bundled catalog, a fixture/override always stands in for it in tests. */
export const DEFAULT_REGISTRY_URL =
  'https://raw.githubusercontent.com/yapaja/yapaja-addons-registry/main/index.json';

/** Settings key holding an operator-configured override for the registry
 *  index URL. `ADDONS_REGISTRY_URL` (env) takes precedence, same
 *  env-wins-over-settings convention `authGuard.ts` documents for
 *  `API_AUTH_TOKEN` / `auth.token`. */
export const REGISTRY_URL_SETTINGS_KEY = 'addons.registry.url';

/** Settings key holding the last successfully synced catalog + metadata. */
export const REGISTRY_CACHE_SETTINGS_KEY = 'addons.registry.cache';

/** Generous cap for a JSON catalog fetch -- large enough for a registry with
 *  hundreds of entries (screenshots are only URLs, never embedded bytes),
 *  small enough to still be a real "reject implausible payloads" guard
 *  against a hostile/misbehaving server. `downloadTarball` enforces this
 *  WHILE STREAMING, so an oversized response is aborted early either way. */
export const MAX_REGISTRY_INDEX_BYTES = 4 * 1024 * 1024;

/** Longest accepted string for name/description/url-ish fields -- guards
 *  against the "implausible values" hostile-fixture class (a 50 MB `name`
 *  string is a valid JSON string, but not a plausible catalog entry). */
const MAX_NAME_LENGTH = 200;
const MAX_DESCRIPTION_LENGTH = 4000;
const MAX_URL_LENGTH = 2000;
const MAX_ID_LENGTH = 200;
const MAX_SIGNATURE_LENGTH = 4000;
/** Caps on ARRAY fields for the same reason. */
const MAX_SCOPES = 64;
const MAX_SCREENSHOTS = 20;

const SHA256_RE = /^[a-f0-9]{64}$/i;
const NET_FETCH_RE = new RegExp(ADDON_NET_FETCH_PATTERN);
const PERMISSION_SET: ReadonlySet<string> = new Set<string>(ADDON_PERMISSION_SCOPES);

/** One validated, trustworthy-SHAPE (not trustworthy-CONTENT) registry
 *  entry. Mirrors docs/05 §5's documented index fields exactly: "id, name,
 *  version, beschreibung, icon, download_url -> Release-Tarball, sha256,
 *  scopes, core_api, screenshots" (+ the reserved `signature`). */
export interface RegistryEntry {
  id: string;
  name: string;
  version: string;
  description: string;
  /** Icon URL (http/https) or `data:` URI; optional. */
  icon: string | null;
  download_url: string;
  /** Lowercase hex, always exactly 64 chars -- see the module doc for why
   *  this is the ONE field {@link validateEntry} is strictest about. */
  sha256: string;
  /** Permission scopes this add-on will request at install (docs/05 §2) --
   *  shown as the store's "scope preview" BEFORE the operator ever starts
   *  the real install/confirm flow. */
  scopes: string[];
  /** Semver RANGE (Wargame W-11), checked against the running Core's
   *  version by the ROUTE layer (`registryRoutes.ts`), reusing the exact
   *  same `satisfies()` helper `installService.ts` uses -- one
   *  implementation, never duplicated. */
  core_api: string;
  screenshots: string[];
  /** RESERVED, NEVER VERIFIED -- see the module doc. `null` when absent. */
  signature: string | null;
}

export interface RegistryValidationResult {
  entries: RegistryEntry[];
  /** Human-readable reasons for every DROPPED entry (bad shape, duplicate
   *  id, ...) -- surfaced to the operator via the sync response so a
   *  rejected entry is diagnosable, not just silently missing. */
  errors: string[];
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isHttpOrDataUrl(value: string, opts: { allowData: boolean } = { allowData: false }): boolean {
  if (opts.allowData && value.startsWith('data:')) return value.length <= MAX_URL_LENGTH * 20; // data URIs may legitimately be longer (small icon), still bounded
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}

function isValidScope(scope: unknown): scope is string {
  return typeof scope === 'string' && (PERMISSION_SET.has(scope) || NET_FETCH_RE.test(scope));
}

/**
 * Validates ONE untrusted index entry. Returns the normalized entry on
 * success, or `null` (with a reason string) on ANY shape violation --
 * missing/wrong-typed required fields, an implausible value, or a malformed
 * `sha256`. Every hostile-fixture case the task spec calls out by name
 * (wrong hash shape, missing fields, huge/implausible values) is rejected
 * here; DUPLICATE ids are a cross-entry concern handled by the caller
 * ({@link validateRegistryIndex}).
 */
export function validateEntry(raw: unknown): { entry: RegistryEntry } | { reason: string } {
  if (!isPlainObject(raw)) {
    return { reason: 'entry is not a JSON object' };
  }
  const e = raw;

  if (typeof e.id !== 'string' || e.id.length === 0 || e.id.length > MAX_ID_LENGTH || !ADDON_ID_RE.test(e.id)) {
    return { reason: `entry has an invalid "id": ${JSON.stringify(e.id)}` };
  }
  if (typeof e.name !== 'string' || e.name.trim().length === 0 || e.name.length > MAX_NAME_LENGTH) {
    return { reason: `entry "${String(e.id)}" has an invalid "name"` };
  }
  if (typeof e.version !== 'string' || !isValidSemver(e.version)) {
    return { reason: `entry "${String(e.id)}" has an invalid "version" (must be exact semver)` };
  }
  if (typeof e.description !== 'string' || e.description.trim().length === 0 || e.description.length > MAX_DESCRIPTION_LENGTH) {
    return { reason: `entry "${String(e.id)}" has an invalid "description"` };
  }
  if (
    typeof e.download_url !== 'string' ||
    e.download_url.length === 0 ||
    e.download_url.length > MAX_URL_LENGTH ||
    !isHttpOrDataUrl(e.download_url)
  ) {
    return { reason: `entry "${String(e.id)}" has an invalid "download_url" (must be http(s))` };
  }
  // The single field this module is strictest about (see the module doc):
  // a missing OR malformed sha256 drops the entry outright, rather than
  // letting a bad/absent digest silently reach the install pipeline as
  // `undefined` (which would only be caught later, and only for a URL
  // install where it's already mandatory -- catching it HERE means a
  // hostile/broken registry entry never even renders an install button
  // with a false sense of "this is checked").
  if (typeof e.sha256 !== 'string' || !SHA256_RE.test(e.sha256.trim())) {
    return { reason: `entry "${String(e.id)}" has a missing or malformed "sha256" (must be 64 hex chars)` };
  }
  if (typeof e.core_api !== 'string' || !isValidRange(e.core_api)) {
    return { reason: `entry "${String(e.id)}" has an invalid "core_api" (must be a semver range)` };
  }
  if (!Array.isArray(e.scopes) || e.scopes.length > MAX_SCOPES || !e.scopes.every(isValidScope)) {
    return { reason: `entry "${String(e.id)}" has an invalid "scopes" array` };
  }
  let icon: string | null = null;
  if (e.icon !== undefined) {
    if (typeof e.icon !== 'string' || e.icon.length > MAX_URL_LENGTH * 20 || !isHttpOrDataUrl(e.icon, { allowData: true })) {
      return { reason: `entry "${String(e.id)}" has an invalid "icon"` };
    }
    icon = e.icon;
  }
  let screenshots: string[] = [];
  if (e.screenshots !== undefined) {
    if (
      !Array.isArray(e.screenshots) ||
      e.screenshots.length > MAX_SCREENSHOTS ||
      !e.screenshots.every((s) => typeof s === 'string' && s.length <= MAX_URL_LENGTH && isHttpOrDataUrl(s))
    ) {
      return { reason: `entry "${String(e.id)}" has an invalid "screenshots" array` };
    }
    screenshots = e.screenshots as string[];
  }
  let signature: string | null = null;
  if (e.signature !== undefined && e.signature !== null) {
    if (typeof e.signature !== 'string' || e.signature.length > MAX_SIGNATURE_LENGTH) {
      return { reason: `entry "${String(e.id)}" has an invalid "signature" (reserved field, shape-only check)` };
    }
    signature = e.signature;
  }

  return {
    entry: {
      id: e.id,
      name: e.name.trim(),
      version: e.version,
      description: e.description.trim(),
      icon,
      download_url: e.download_url,
      sha256: e.sha256.trim().toLowerCase(),
      scopes: [...(e.scopes as string[])],
      core_api: e.core_api,
      screenshots,
      signature,
    },
  };
}

/**
 * Validates a whole untrusted `index.json` payload.
 *
 * - Root is not a JSON array -> the WHOLE index is rejected (nothing safe to
 *   iterate); `entries: []`, one error explaining why.
 * - Root IS an array -> each element is validated independently
 *   ({@link validateEntry}); a bad entry is DROPPED (not fatal to the rest).
 * - A duplicate `id` (second+ occurrence) is ALSO dropped -- the FIRST
 *   occurrence wins -- and recorded as an error, so a malicious/broken
 *   registry can never shadow/override an earlier entry silently.
 */
export function validateRegistryIndex(raw: unknown): RegistryValidationResult {
  if (!Array.isArray(raw)) {
    return { entries: [], errors: ['registry index root must be a JSON array'] };
  }
  const entries: RegistryEntry[] = [];
  const errors: string[] = [];
  const seenIds = new Set<string>();

  for (let i = 0; i < raw.length; i++) {
    const result = validateEntry(raw[i]);
    if ('reason' in result) {
      errors.push(`index[${i}]: ${result.reason}`);
      continue;
    }
    if (seenIds.has(result.entry.id)) {
      errors.push(`index[${i}]: duplicate id "${result.entry.id}" -- keeping the first occurrence`);
      continue;
    }
    seenIds.add(result.entry.id);
    entries.push(result.entry);
  }

  return { entries, errors };
}

export class RegistryError extends Error {
  code: string;
  constructor(code: string, message: string) {
    super(message);
    this.code = code;
    this.name = 'RegistryError';
  }
}

/** Just the settings ops this service needs; `SettingsService` satisfies it
 *  structurally (same pattern as `storageService.ts#AddonStorageSettings`). */
export interface RegistrySettingsLookup {
  get(key: string): unknown;
  patch(values: Record<string, unknown>): Record<string, unknown>;
}

/** The cached-catalog shape persisted under {@link REGISTRY_CACHE_SETTINGS_KEY}
 *  and returned by both `getCachedCatalog()` and `sync()`. */
export interface RegistryCacheSnapshot {
  entries: RegistryEntry[];
  /** ISO 8601 UTC timestamp of the last SUCCESSFUL sync, or `null` if the
   *  registry has never been synced (fresh install, or offline since day one --
   *  W-13's "the store must still be usable" case). */
  fetchedAt: string | null;
  /** `Date.now() - fetchedAt` in ms at the moment this snapshot was built, or
   *  `null` when `fetchedAt` is `null`. Computed fresh on every read rather
   *  than stored, so "Stand: vor 3 Wochen" is always accurate even if the
   *  Core process has been up for weeks since the last sync. */
  ageMs: number | null;
  sourceUrl: string;
  /** Validation errors from the last successful parse (dropped entries) --
   *  kept alongside the cache so an operator can see WHY a registry entry
   *  they expected is missing, without needing to sync again. */
  errors: string[];
}

function isRegistryCacheSnapshotShape(value: unknown): value is {
  entries: unknown;
  fetchedAt: unknown;
  sourceUrl: unknown;
  errors: unknown;
} {
  return isPlainObject(value) && 'entries' in value;
}

export interface RegistryServiceOptions {
  settings?: RegistrySettingsLookup;
  /** Defaults to `process.env`; overridable for tests. */
  env?: Record<string, string | undefined>;
  /** Fetches raw bytes for a URL, capped at {@link MAX_REGISTRY_INDEX_BYTES}.
   *  Defaults to the SAME hardened `downloadTarball()` the install pipeline
   *  already uses for tarball URLs (streaming size cap, 30 s timeout,
   *  http(s)-only) -- deliberately reused rather than a second bespoke HTTP
   *  client, despite the name: an `index.json` fetch has the exact same
   *  "bounded GET, buffer fully, enforce a byte cap while streaming"
   *  requirements a tarball fetch does. */
  fetchIndexBytes?: (url: string) => Promise<Buffer>;
}

/**
 * Loads/validates/caches the registry catalog (E09-T7). `getCachedCatalog()`
 * NEVER makes a network call (W-13: the store must stay usable purely from
 * cache); only `sync()` does, and a FAILED sync leaves the previously cached
 * catalog completely untouched -- "Registry unreachable -> Store nutzbar mit
 * Cache+Upload" only holds if a failed sync can never wipe what was there.
 */
export class RegistryService {
  private readonly settings: RegistrySettingsLookup;
  private readonly env: Record<string, string | undefined>;
  private readonly fetchIndexBytes: (url: string) => Promise<Buffer>;

  constructor(opts: RegistryServiceOptions = {}) {
    this.settings = opts.settings ?? new SettingsService();
    this.env = opts.env ?? process.env;
    this.fetchIndexBytes =
      opts.fetchIndexBytes ?? ((url) => downloadTarball({ url, maxBytes: MAX_REGISTRY_INDEX_BYTES }));
  }

  /** `ADDONS_REGISTRY_URL` (env) wins over the `addons.registry.url` setting,
   *  which wins over {@link DEFAULT_REGISTRY_URL} -- same precedence
   *  convention `authGuard.ts` documents for `API_AUTH_TOKEN`/`auth.token`. */
  resolveUrl(): string {
    const envUrl = this.env.ADDONS_REGISTRY_URL;
    if (typeof envUrl === 'string' && envUrl.trim() !== '') return envUrl.trim();
    const settingsUrl = this.settings.get(REGISTRY_URL_SETTINGS_KEY);
    if (typeof settingsUrl === 'string' && settingsUrl.trim() !== '') return settingsUrl.trim();
    return DEFAULT_REGISTRY_URL;
  }

  /** Reads the cache -- ALWAYS OFFLINE, never touches the network. Returns
   *  an empty catalog (not an error) when nothing has ever been synced. */
  getCachedCatalog(): RegistryCacheSnapshot {
    const raw = this.settings.get(REGISTRY_CACHE_SETTINGS_KEY);
    if (!isRegistryCacheSnapshotShape(raw)) {
      return { entries: [], fetchedAt: null, ageMs: null, sourceUrl: this.resolveUrl(), errors: [] };
    }
    const entries = Array.isArray(raw.entries) ? (raw.entries as RegistryEntry[]) : [];
    const fetchedAt = typeof raw.fetchedAt === 'string' ? raw.fetchedAt : null;
    const sourceUrl = typeof raw.sourceUrl === 'string' ? raw.sourceUrl : this.resolveUrl();
    const errors = Array.isArray(raw.errors) ? (raw.errors as string[]) : [];
    const ageMs = fetchedAt ? Math.max(0, Date.now() - Date.parse(fetchedAt)) : null;
    return { entries, fetchedAt, ageMs, sourceUrl, errors };
  }

  /**
   * Fetches + validates + persists a fresh catalog. Throws
   * {@link RegistryError} (`REGISTRY_UNREACHABLE` for a network/HTTP
   * failure, `REGISTRY_INVALID` for a non-JSON body) WITHOUT touching the
   * existing cache -- a caller that only wants "the latest cache, refreshed
   * if possible, else whatever we had" should catch this and fall back to
   * {@link getCachedCatalog}.
   */
  async sync(): Promise<RegistryCacheSnapshot> {
    const url = this.resolveUrl();
    let bytes: Buffer;
    try {
      bytes = await this.fetchIndexBytes(url);
    } catch (err) {
      throw new RegistryError(
        'REGISTRY_UNREACHABLE',
        `Could not reach the add-on registry at ${url}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
    let raw: unknown;
    try {
      raw = JSON.parse(bytes.toString('utf-8'));
    } catch {
      throw new RegistryError('REGISTRY_INVALID', `${url} did not return valid JSON`);
    }
    const { entries, errors } = validateRegistryIndex(raw);
    const fetchedAt = new Date().toISOString();
    this.settings.patch({ [REGISTRY_CACHE_SETTINGS_KEY]: { entries, fetchedAt, sourceUrl: url, errors } });
    return { entries, fetchedAt, ageMs: 0, sourceUrl: url, errors };
  }
}
