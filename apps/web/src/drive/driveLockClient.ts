/**
 * Persistence for the Speed-Lock THRESHOLD (E07-T4): localStorage
 * (device-local, instant) + the general-purpose settings service
 * (`GET`/`PATCH /api/v1/settings`, key `driveLock` -- same endpoint E07-T1's
 * `layouts` and E07-T3's `theme` keys already use, see
 * `apps/web/src/shell/persistence.ts` / `apps/web/src/theme/themeClient.ts`,
 * whose local-cache-first/server-best-effort pattern this mirrors exactly).
 *
 * The `driveLock` key's value shape is `{ thresholdKmh: number }`, kept as a
 * small object (not a bare number) for the same forward-compatibility
 * reason `theme`'s `{ mode }` shape documents -- room to grow (e.g. a future
 * per-surface override) without a breaking shape change.
 */

import { DEFAULT_DRIVE_LOCK_KMH } from './driveLock.js';

const LOCAL_STORAGE_KEY = 'yapaja.driveLock.thresholdKmh';
const SETTINGS_KEY = 'driveLock';

function isValidThresholdKmh(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0;
}

function apiUrl(path: string): string {
  return `${import.meta.env.BASE_URL}${path}`;
}

/** Reads the device-local cache. `null` on first run or any parse/shape
 *  failure (never throws -- a corrupted cache must not crash the app). */
export function loadLocalDriveLockThresholdKmh(): number | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(LOCAL_STORAGE_KEY);
    if (raw === null) return null;
    const parsed = Number(raw);
    return isValidThresholdKmh(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

export function saveLocalDriveLockThresholdKmh(thresholdKmh: number): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(LOCAL_STORAGE_KEY, String(thresholdKmh));
  } catch {
    // Storage full/unavailable -- best-effort, mirrors themeClient.ts/persistence.ts.
  }
}

/** Fetches the server's `driveLock` setting. `null` on any failure or if the
 *  key was never set -- callers fall back to the local cache/default,
 *  identical contract to `themeClient.ts#fetchServerThemeMode`. Deliberately
 *  `GET /api/v1/settings` (always 200) rather than the single-key route
 *  (404s on first run -- see `persistence.ts`'s doc comment for why that
 *  404 would trip the "no console errors" e2e invariant). */
export async function fetchServerDriveLockThresholdKmh(): Promise<number | null> {
  try {
    const response = await fetch(apiUrl('api/v1/settings'));
    if (!response.ok) return null;
    const body = (await response.json()) as { data: Record<string, unknown> };
    const value = body?.data?.[SETTINGS_KEY] as { thresholdKmh?: unknown } | undefined;
    return isValidThresholdKmh(value?.thresholdKmh) ? value.thresholdKmh : null;
  } catch {
    return null;
  }
}

/** Persists `thresholdKmh` to the server (`PATCH /settings`, `driveLock`
 *  key). Best-effort: offline is a normal operating mode for this app. */
export async function patchServerDriveLockThresholdKmh(thresholdKmh: number): Promise<void> {
  try {
    await fetch(apiUrl('api/v1/settings'), {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ [SETTINGS_KEY]: { thresholdKmh } }),
    });
  } catch {
    // Best-effort -- see doc comment above.
  }
}

/** Boot-time load: local cache first (instant), then the server value once
 *  it resolves. Writes back to the local cache in the meantime. Never
 *  returns `null` -- callers get a usable threshold immediately
 *  (`DEFAULT_DRIVE_LOCK_KMH` if nothing else is known). */
export async function loadDriveLockThresholdKmh(): Promise<number> {
  const local = loadLocalDriveLockThresholdKmh();
  const server = await fetchServerDriveLockThresholdKmh();
  const resolved = server ?? local ?? DEFAULT_DRIVE_LOCK_KMH;
  saveLocalDriveLockThresholdKmh(resolved);
  return resolved;
}
