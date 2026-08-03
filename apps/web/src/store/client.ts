/**
 * Fetch helpers for the add-on Store (E09-T7, docs/05 §5): the cached
 * registry catalog + sync, and the two-step scope-confirm install flow
 * (`POST /addons/install` -> `POST /addons/install/:pendingId/confirm`,
 * both already built by E09-T1 -- this module only calls them, it never
 * re-implements sha256/`core_api` enforcement). Every URL is built from
 * `import.meta.env.BASE_URL`, matching every other web client in this app
 * (ingress-sub-path-safe, W-15).
 */

import type { AddonManifest } from '@yapaja/shared';
import type { InstalledAddon } from '../addons/client.js';

export interface RegistryEntryView {
  id: string;
  name: string;
  version: string;
  description: string;
  icon: string | null;
  download_url: string;
  sha256: string;
  scopes: string[];
  /** Semver range (Wargame W-11). */
  core_api: string;
  screenshots: string[];
  /** RESERVED, never verified client- or server-side yet -- see
   *  `docs/registry-guide.md`. */
  signature: string | null;
  /** Computed by the Core against the RUNNING Core's version, BEFORE any
   *  install attempt (Wargame W-11) -- the Store renders a blocking notice
   *  instead of an install/update button whenever this is `false`. */
  compatible: boolean;
}

export interface RegistryCatalog {
  entries: RegistryEntryView[];
  /** ISO 8601 UTC, or `null` if the registry has never been synced. */
  fetchedAt: string | null;
  /** Cache age in ms, or `null` when `fetchedAt` is `null`. */
  ageMs: number | null;
  sourceUrl: string;
  /** Validation errors for entries the Core DROPPED from the last sync
   *  (hostile/malformed entries) -- shown for operator transparency. */
  errors: string[];
}

const EMPTY_CATALOG: RegistryCatalog = {
  entries: [],
  fetchedAt: null,
  ageMs: null,
  sourceUrl: '',
  errors: [],
};

export interface PendingInstall {
  pendingId: string;
  manifest: AddonManifest;
  permissions: string[];
  warnings: string[];
  isUpdate: boolean;
  sha256: string;
  expiresAt: string;
}

interface ApiErrorBody {
  error: { code: string; message: string; details?: Record<string, unknown> };
}

/** Thrown by every mutating call below, carrying the Core's unified
 *  `{error:{code,message}}` shape (same pattern `regions/client.ts`'s
 *  `RegionApiError` already established) so callers can render a specific
 *  message for e.g. `SHA256_MISMATCH` / `INCOMPATIBLE_CORE_API`. */
export class StoreApiError extends Error {
  code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = 'StoreApiError';
    this.code = code;
  }
}

function apiUrl(path: string): string {
  return `${import.meta.env.BASE_URL}${path}`;
}

async function toApiError(response: Response): Promise<StoreApiError> {
  try {
    const body = (await response.json()) as ApiErrorBody;
    if (body?.error?.code && body.error.message) {
      return new StoreApiError(body.error.code, body.error.message);
    }
  } catch {
    // Body wasn't the expected error shape; fall through to a generic error.
  }
  return new StoreApiError('UNKNOWN', `Request failed with status ${response.status}`);
}

interface RawRegistryCatalog {
  entries: RegistryEntryView[];
  fetched_at: string | null;
  age_ms: number | null;
  source_url: string;
  errors: string[];
}

function normalizeCatalog(raw: RawRegistryCatalog): RegistryCatalog {
  return {
    entries: Array.isArray(raw.entries) ? raw.entries : [],
    fetchedAt: raw.fetched_at ?? null,
    ageMs: typeof raw.age_ms === 'number' ? raw.age_ms : null,
    sourceUrl: raw.source_url ?? '',
    errors: Array.isArray(raw.errors) ? raw.errors : [],
  };
}

/** The CACHED catalog -- never touches the network on the Core side (W-13),
 *  and never throws here either: a fetch/parse failure returns the empty
 *  catalog so the Store still renders (with its offline/upload path) rather
 *  than crashing. */
export async function fetchRegistryCatalog(): Promise<RegistryCatalog> {
  try {
    const res = await fetch(apiUrl('api/v1/addons/registry'));
    if (!res.ok) return EMPTY_CATALOG;
    const body = (await res.json()) as { data?: RawRegistryCatalog };
    return body.data ? normalizeCatalog(body.data) : EMPTY_CATALOG;
  } catch {
    return EMPTY_CATALOG;
  }
}

/** Triggers a fresh fetch+validate+persist. Throws `StoreApiError` (e.g.
 *  `REGISTRY_UNREACHABLE`) on failure -- callers should keep showing
 *  whatever `fetchRegistryCatalog()` last returned rather than clearing the
 *  UI on a failed sync. */
export async function syncRegistry(): Promise<RegistryCatalog> {
  const res = await fetch(apiUrl('api/v1/addons/registry/sync'), { method: 'POST' });
  if (!res.ok) {
    throw await toApiError(res);
  }
  const body = (await res.json()) as { data: RawRegistryCatalog };
  return normalizeCatalog(body.data);
}

interface RawPendingInstall {
  pending_id: string;
  manifest: AddonManifest;
  permissions: string[];
  warnings: string[];
  is_update: boolean;
  sha256: string;
  expires_at: string;
}

function normalizePending(raw: RawPendingInstall): PendingInstall {
  return {
    pendingId: raw.pending_id,
    manifest: raw.manifest,
    permissions: raw.permissions,
    warnings: raw.warnings,
    isUpdate: raw.is_update,
    sha256: raw.sha256,
    expiresAt: raw.expires_at,
  };
}

/** Step 1 of a registry (or arbitrary URL) install: the `url` + `sha256`
 *  passed here are forwarded to the Core VERBATIM -- for a registry entry
 *  they must be exactly what `fetchRegistryCatalog()`/`syncRegistry()`
 *  returned, so the digest the operator is shown/confirms is the SAME one
 *  `installService.ts` enforces (a URL install's `sha256` is mandatory
 *  server-side; this call can never "skip" it, only supply it). */
export async function beginInstallFromUrl(url: string, sha256: string): Promise<PendingInstall> {
  const res = await fetch(apiUrl('api/v1/addons/install'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ source: 'url', url, sha256 }),
  });
  if (!res.ok) throw await toApiError(res);
  const body = (await res.json()) as { data: RawPendingInstall };
  return normalizePending(body.data);
}

/** Step 1, upload source (W-13: "Upload-Install prominent" when the
 *  registry is unreachable). `sha256` is optional for an upload but, if
 *  supplied, is still verified (see `installService.ts`). */
export async function beginInstallFromUpload(base64Data: string, sha256?: string): Promise<PendingInstall> {
  const res = await fetch(apiUrl('api/v1/addons/install'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ source: 'upload', data: base64Data, ...(sha256 ? { sha256 } : {}) }),
  });
  if (!res.ok) throw await toApiError(res);
  const body = (await res.json()) as { data: RawPendingInstall };
  return normalizePending(body.data);
}

/** Step 2: actually unpack + write the DB row (fresh install, or an update
 *  with rollback if the id is already installed). */
export async function confirmPendingInstall(pendingId: string): Promise<InstalledAddon> {
  const res = await fetch(apiUrl(`api/v1/addons/install/${encodeURIComponent(pendingId)}/confirm`), {
    method: 'POST',
  });
  if (!res.ok) throw await toApiError(res);
  const body = (await res.json()) as { data: InstalledAddon };
  return body.data;
}

export async function enableAddon(id: string): Promise<InstalledAddon> {
  const res = await fetch(apiUrl(`api/v1/addons/${encodeURIComponent(id)}/enable`), { method: 'POST' });
  if (!res.ok) throw await toApiError(res);
  const body = (await res.json()) as { data: InstalledAddon };
  return body.data;
}

export async function disableAddon(id: string): Promise<InstalledAddon> {
  const res = await fetch(apiUrl(`api/v1/addons/${encodeURIComponent(id)}/disable`), { method: 'POST' });
  if (!res.ok) throw await toApiError(res);
  const body = (await res.json()) as { data: InstalledAddon };
  return body.data;
}

export async function uninstallAddonById(id: string): Promise<void> {
  const res = await fetch(apiUrl(`api/v1/addons/${encodeURIComponent(id)}`), { method: 'DELETE' });
  if (!res.ok) throw await toApiError(res);
}

/** Converts a raw tarball `ArrayBuffer` to base64 for the upload-install
 *  JSON envelope (`routes.ts`'s documented "base64 inside JSON" transport).
 *  Chunked (32 KiB) so `String.fromCharCode` never blows the engine's
 *  max-arguments limit on a large (up to 50 MB) tarball. */
export function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  const chunkSize = 0x8000;
  let binary = '';
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const chunk = bytes.subarray(i, i + chunkSize);
    binary += String.fromCharCode(...chunk);
  }
  return btoa(binary);
}
