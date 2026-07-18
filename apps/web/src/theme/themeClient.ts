/**
 * Persistence for the theme MODE (E07-T3): localStorage (device-local,
 * instant) + the general-purpose settings store (`GET`/`PATCH
 * /api/v1/settings`, key `theme` -- `apps/core/src/settings/`, same one
 * E07-T1's `layouts` key already uses, see `apps/web/src/shell/
 * persistence.ts`). This is deliberately the ONLY thing persisted server-
 * side -- a manual override is a short-lived, session-scoped hold (docs/06
 * §3: it lapses at the next sunrise/sunset anyway), not a durable setting.
 *
 * The `theme` key's value shape is `{ mode: ThemeMode }`, kept as a small
 * object (not a bare string) so it can grow additional fields later without
 * a breaking shape change -- same defensive habit as `layouts`.
 *
 * E08 (HA integration, per the task's "Später von HA übersteuerbar" note)
 * only needs this key to be readable/writable through the existing generic
 * settings endpoint; no HA-specific code lives here.
 */

import type { ThemeMode } from './resolveTheme.js';

const LOCAL_STORAGE_KEY = 'yapaja.theme.mode';
const SETTINGS_KEY = 'theme';

const VALID_MODES: readonly ThemeMode[] = ['light', 'dark', 'auto'];

/**
 * Deliberately `'light'`, NOT `'auto'`, even though "automatic day/night" is
 * this task's headline feature. `'auto'` with no position fix falls back to
 * the REAL device clock (`sunResolution.ts#resolveClockTheme`) -- if it were
 * the default, then every one of this app's 30+ pre-existing e2e specs that
 * never touch theming at all would non-deterministically render dark
 * (`<html class="dark">`, `yapaja-dark` map style) whenever the CI run's
 * real wall-clock happens to land between 19:00-07:00, purely as a side
 * effect of this task existing. A theme mode is an explicit user choice
 * (docs/06 §3 lists three: hell/dunkel/auto) with no historical default to
 * infer -- `'light'` matches this app's pre-existing, deterministic default
 * (`state/styleStore.ts`'s `DEFAULT_STYLE_ID = 'yapaja-light'`), so a fresh
 * install/reload behaves identically regardless of time of day unless/until
 * the user (or E08/HA) explicitly opts into `'auto'`.
 */
export const DEFAULT_THEME_MODE: ThemeMode = 'light';

function isThemeMode(value: unknown): value is ThemeMode {
  return typeof value === 'string' && (VALID_MODES as readonly string[]).includes(value);
}

function apiUrl(path: string): string {
  return `${import.meta.env.BASE_URL}${path}`;
}

/** Reads the device-local cache. `null` on first run or any parse failure
 *  (never throws -- a corrupted cache must not crash the app). */
export function loadLocalThemeMode(): ThemeMode | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(LOCAL_STORAGE_KEY);
    return isThemeMode(raw) ? raw : null;
  } catch {
    return null;
  }
}

export function saveLocalThemeMode(mode: ThemeMode): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(LOCAL_STORAGE_KEY, mode);
  } catch {
    // Storage full/unavailable -- best-effort, mirrors styleStore.ts/persistence.ts.
  }
}

/** Fetches the server's `theme` setting. `null` on any failure or if the
 *  key was never set -- callers fall back to the local cache/default,
 *  identical contract to `persistence.ts#fetchServerLayouts`. Deliberately
 *  `GET /api/v1/settings` (always 200) rather than the single-key route
 *  (404s on first run -- see `persistence.ts`'s doc comment for why that
 *  404 would trip the "no console errors" e2e invariant). */
export async function fetchServerThemeMode(): Promise<ThemeMode | null> {
  try {
    const response = await fetch(apiUrl('api/v1/settings'));
    if (!response.ok) return null;
    const body = (await response.json()) as { data: Record<string, unknown> };
    const value = body?.data?.[SETTINGS_KEY] as { mode?: unknown } | undefined;
    return isThemeMode(value?.mode) ? (value.mode as ThemeMode) : null;
  } catch {
    return null;
  }
}

/** Persists `mode` to the server (`PATCH /settings`, `theme` key).
 *  Best-effort: offline is a normal operating mode for this app. */
export async function patchServerThemeMode(mode: ThemeMode): Promise<void> {
  try {
    await fetch(apiUrl('api/v1/settings'), {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ [SETTINGS_KEY]: { mode } }),
    });
  } catch {
    // Best-effort -- see doc comment above.
  }
}

/** Boot-time load: local cache first (instant, no flash of the wrong
 *  theme), then the server value once it resolves (a value already synced
 *  from another device). Writes back to the local cache in the meantime, so
 *  the NEXT load has it even if the server round-trip never returns
 *  (offline core, first run, ...). Never returns `null` -- callers get a
 *  usable mode immediately (`DEFAULT_THEME_MODE`, "auto", if nothing else
 *  is known). */
export async function loadThemeMode(): Promise<ThemeMode> {
  const local = loadLocalThemeMode();
  const server = await fetchServerThemeMode();
  const resolved = server ?? local ?? DEFAULT_THEME_MODE;
  saveLocalThemeMode(resolved);
  return resolved;
}
