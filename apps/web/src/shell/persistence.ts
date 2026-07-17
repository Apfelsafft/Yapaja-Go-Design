/**
 * Layout persistence (E07-T1): localStorage cache (per-device) + server sync
 * via `PATCH /api/v1/settings` (`layouts` key), reconciled with the
 * "newest timestamp wins" rule (`layout.ts#mergeLayouts`).
 *
 * `import.meta.env.BASE_URL`-relative URLs, same convention as
 * `favorites/client.ts` / `settings/regions/client.ts` -- offline,
 * ingress-sub-path-safe (W-15).
 */

import { mergeLayouts, type LayoutsSettingsValue } from './layout.js';

const LOCAL_STORAGE_KEY = 'yapaja:shell:layouts';

function apiUrl(path: string): string {
  return `${import.meta.env.BASE_URL}${path}`;
}

/** Reads the device-local cache. Returns `null` on first run, and defensively
 *  on any parse/shape failure (never throws -- a corrupted cache must not
 *  crash the shell, docs "no silent failures" applies to the FAILURE MODE,
 *  not to swallowing a clearly-corrupt local blob). */
export function loadLocalLayouts(): Partial<LayoutsSettingsValue> | null {
  if (typeof window === 'undefined') return null; // SSR/Node-test guard, mirrors state/styleStore.ts
  try {
    const raw = window.localStorage.getItem(LOCAL_STORAGE_KEY);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return null;
    return parsed as Partial<LayoutsSettingsValue>;
  } catch {
    return null;
  }
}

/** Writes the full merged layouts to the device-local cache. */
export function saveLocalLayouts(layouts: LayoutsSettingsValue): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(layouts));
  } catch {
    // Storage full/unavailable (private browsing etc.) -- the server sync
    // below is still attempted; losing the local cache is degraded, not fatal.
  }
}

/**
 * Fetches the server's `layouts` setting. Returns `null` on any failure
 * (offline Core, key never set, malformed response) -- callers treat that
 * identically to "server has nothing yet", never a hard error (the shell
 * must render its OWN cached/default layout even with no Core reachable).
 *
 * Deliberately calls `GET /api/v1/settings` (the full map) rather than
 * `GET /api/v1/settings/layouts` (the single-key route): the single-key
 * route 404s when the key was never set -- the ExpECTED, common case for a
 * brand-new install/browser -- and a 404 response is exactly the kind of
 * thing Chrome logs to the console on its own ("Failed to load resource...")
 * REGARDLESS of this function handling it gracefully, which would trip the
 * "no console errors" invariant every other e2e spec in this repo enforces
 * for an entirely expected, non-error condition. `GET /api/v1/settings`
 * always answers 200 (an empty object when nothing has been set yet), so
 * there is no such false-positive path.
 */
export async function fetchServerLayouts(): Promise<Partial<LayoutsSettingsValue> | null> {
  try {
    const response = await fetch(apiUrl('api/v1/settings'));
    if (!response.ok) return null;
    const body = (await response.json()) as { data: Record<string, unknown> };
    const layouts = body?.data?.layouts;
    if (!layouts || typeof layouts !== 'object') return null;
    return layouts as Partial<LayoutsSettingsValue>;
  } catch {
    return null;
  }
}

/** Persists the full merged layouts to the server (`PATCH /settings`,
 *  `layouts` key). Best-effort: swallows failures (offline is a normal
 *  operating mode for this app) -- the local cache is the fallback of
 *  record, and the next successful sync reconciles by timestamp anyway. */
export async function patchServerLayouts(layouts: LayoutsSettingsValue): Promise<void> {
  try {
    await fetch(apiUrl('api/v1/settings'), {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ layouts }),
    });
  } catch {
    // Best-effort -- see doc comment above.
  }
}

/**
 * Boot-time reconciliation: read the local cache, fetch the server's copy,
 * merge by newest timestamp (per mode independently), then write the merged
 * result back to BOTH the local cache and the server -- so either side that
 * was stale catches up immediately (the "second device" acceptance
 * criterion: a device with no local cache picks up the server's layout on
 * its very first load; a device whose local edit never made it to the
 * server retries the sync here on its next load).
 */
export async function loadAndReconcileLayouts(): Promise<LayoutsSettingsValue> {
  const local = loadLocalLayouts();
  const server = await fetchServerLayouts();
  const merged = mergeLayouts(local, server); // falls back to built-in defaults per-mode when neither source has it

  saveLocalLayouts(merged);
  void patchServerLayouts(merged); // fire-and-forget; never blocks first render on the Core being reachable

  return merged;
}
