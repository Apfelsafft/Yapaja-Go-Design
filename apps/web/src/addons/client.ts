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

/** The iframe src for an add-on's UI entry. The Core serves the add-on's
 *  `ui/` subtree at `/addons/{id}/ui/`, so a manifest entry like `ui/index.html`
 *  maps to `/addons/{id}/ui/index.html` (leading `ui/` stripped). */
export function addonUiSrc(addonId: string, entry: string): string {
  const rel = entry.replace(/^ui\//, '');
  return `${import.meta.env.BASE_URL}addons/${encodeURIComponent(addonId)}/ui/${rel}`;
}
