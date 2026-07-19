/**
 * Persistence for the onboarding wizard (E08-T5): the general-purpose
 * settings store (`GET`/`PATCH /api/v1/settings`, key `onboarding_state` --
 * same store `theme`/`layouts` already use, see `theme/themeClient.ts` /
 * `shell/persistence.ts`), PLUS the read-only system-resources endpoint
 * (`GET /api/v1/system/resources`, `apps/core/src/system/routes.ts`).
 *
 * Deliberately server-side ONLY (no localStorage cache, unlike
 * theme/layouts): the task spec explicitly calls for wizard progress living
 * in `settings.onboarding_state` so a reload/reconnect resumes at the exact
 * server-known step -- a local cache could otherwise show a STALE step after
 * e.g. a factory-reset settings wipe.
 */

import { coerceOnboardingState, type OnboardingState } from './state.js';
import type { SystemResources } from './resourceRecommendation.js';

const SETTINGS_KEY = 'onboarding_state';

function apiUrl(path: string): string {
  return `${import.meta.env.BASE_URL}${path}`;
}

/** Fetches the server's `onboarding_state` setting. `null` when the key was
 *  never set (fresh instance) or on any failure (offline Core) -- callers
 *  treat both as "start from the beginning" via `initialOnboardingState()`.
 *  Deliberately `GET /api/v1/settings` (always 200), not the single-key
 *  route (404s on first run) -- same rationale as `persistence.ts`'s
 *  `fetchServerLayouts` doc comment (avoids a false "failed to load
 *  resource" console error on the very common fresh-instance case). */
export async function fetchOnboardingState(): Promise<OnboardingState | null> {
  try {
    const response = await fetch(apiUrl('api/v1/settings'));
    if (!response.ok) return null;
    const body = (await response.json()) as { data: Record<string, unknown> };
    const raw = body?.data?.[SETTINGS_KEY];
    return raw === undefined ? null : coerceOnboardingState(raw);
  } catch {
    return null;
  }
}

/** Persists the full onboarding state to the server (`PATCH /settings`,
 *  `onboarding_state` key). Best-effort: swallows failures (offline is a
 *  normal operating mode for this app) -- the wizard's in-memory state is
 *  still correct for the current session either way; the next successful
 *  PATCH (or a reload once back online) catches the server up. */
export async function patchOnboardingState(state: OnboardingState): Promise<void> {
  try {
    await fetch(apiUrl('api/v1/settings'), {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ [SETTINGS_KEY]: state }),
    });
  } catch {
    // Best-effort -- see doc comment above.
  }
}

/** Fetches real measured system resources (`GET /api/v1/system/resources`).
 *  `null` on any failure -- the region step's recommendation banner simply
 *  stays hidden rather than showing a fabricated number. */
export async function fetchSystemResources(): Promise<SystemResources | null> {
  try {
    const response = await fetch(apiUrl('api/v1/system/resources'));
    if (!response.ok) return null;
    const body = (await response.json()) as { data: SystemResources };
    return body?.data ?? null;
  } catch {
    return null;
  }
}

interface AuthStatus {
  enforced: boolean;
  ingress: boolean;
}

/** Fetches `GET /api/v1/auth/status` (always open, E08-T3) -- the MQTT step
 *  reuses its `ingress` flag to detect "running as the HA add-on" (ingress
 *  mode auto-configures MQTT via bashio, docs/04 §3) vs. standalone (needs a
 *  manual broker form). `null` on any failure -- callers default to
 *  standalone (the safer assumption: show the form rather than hide it). */
export async function fetchAuthStatus(): Promise<AuthStatus | null> {
  try {
    const response = await fetch(apiUrl('api/v1/auth/status'));
    if (!response.ok) return null;
    const body = (await response.json()) as { data: AuthStatus };
    return body?.data ?? null;
  } catch {
    return null;
  }
}
