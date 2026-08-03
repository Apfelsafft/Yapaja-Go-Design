/**
 * Thin fetch client for the add-on runtime (E09-T2): lists installed add-ons
 * and reads/writes the namespace-enforced `storage.own` KV. Every URL is built
 * from `import.meta.env.BASE_URL` (offline, ingress-sub-path-safe), matching
 * every other web client in this app.
 */

import type { AddonManifest } from '@yapaja/shared';

export interface InstalledAddon {
  id: string;
  name: string;
  version: string;
  manifest: AddonManifest;
  enabled: boolean;
  /** E09-T8: "In Home Assistant verfügbar" -- whether this add-on's
   *  `events.publish` output is ALSO republished to MQTT. Only meaningful
   *  for an add-on that declares the `events.publish` permission. */
  mqtt_enabled: boolean;
}

function apiUrl(path: string): string {
  return `${import.meta.env.BASE_URL}${path}`;
}

/** Returns installed add-ons (from `GET /api/v1/addons`). */
export async function fetchAddons(): Promise<InstalledAddon[]> {
  const res = await fetch(apiUrl('api/v1/addons'));
  if (!res.ok) return [];
  const body = (await res.json()) as { data?: InstalledAddon[] };
  return body.data ?? [];
}

/** The enabled add-ons that ship a UI (`manifest.ui.entry` present). */
export function enabledUiAddons(addons: InstalledAddon[]): InstalledAddon[] {
  return addons.filter((a) => a.enabled && a.manifest.ui?.entry);
}

/** Reads one KV value for an add-on; `undefined` if unset (404). */
export async function getAddonStorage(addonId: string, key: string): Promise<unknown> {
  const res = await fetch(apiUrl(`api/v1/addons/${encodeURIComponent(addonId)}/storage/${encodeURIComponent(key)}`));
  if (res.status === 404) return undefined;
  if (!res.ok) throw new Error(`storage.get failed: ${res.status}`);
  const body = (await res.json()) as { data?: unknown };
  return body.data;
}

/** Writes one KV value for an add-on (server namespaces it by add-on id). */
export async function setAddonStorage(addonId: string, key: string, value: unknown): Promise<void> {
  const res = await fetch(apiUrl(`api/v1/addons/${encodeURIComponent(addonId)}/storage/${encodeURIComponent(key)}`), {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ value }),
  });
  if (!res.ok) throw new Error(`storage.set failed: ${res.status}`);
}

/**
 * Forwards ONE host-detected add-on sandbox violation to the Core's `security`
 * event channel (E09-T6, W-10 -- `POST /api/v1/security/events`).
 *
 * FIRE AND FORGET BY DESIGN: the refusal has already happened in the bridge
 * before this is called, and a failed report must never turn into a failed
 * refusal (or an unhandled rejection in the host page), so every error is
 * swallowed. The endpoint is host-trusted-only and denied to add-on
 * principals -- see `apps/core/src/security/routes.ts` for the full rationale.
 */
export function reportSecurityViolation(vector: string, addonId: string, detail: string): void {
  void fetch(apiUrl('api/v1/security/events'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ vector, addon_id: addonId, detail }),
  }).catch(() => {
    /* reporting is best-effort; the block itself never depends on it */
  });
}

/** The iframe src for an add-on's UI entry. The Core serves the add-on's
 *  `ui/` subtree at `/addons/{id}/ui/`, so a manifest entry like `ui/index.html`
 *  maps to `/addons/{id}/ui/index.html` (leading `ui/` stripped). */
export function addonUiSrc(addonId: string, entry: string): string {
  const rel = entry.replace(/^ui\//, '');
  return `${import.meta.env.BASE_URL}addons/${encodeURIComponent(addonId)}/ui/${rel}`;
}
