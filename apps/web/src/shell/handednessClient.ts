/**
 * Persistence for the LHD/RHD handedness setting (E07-T4): localStorage +
 * the general-purpose settings service (`GET`/`PATCH /api/v1/settings`, key
 * `handedness`), mirroring `theme/themeClient.ts`'s pattern exactly (see
 * that file's doc comment for the full local-cache-first/server-best-effort
 * rationale, identical here).
 */

import { DEFAULT_HANDEDNESS, isHandedness, type Handedness } from './handedness.js';

const LOCAL_STORAGE_KEY = 'yapaja.handedness';
const SETTINGS_KEY = 'handedness';

function apiUrl(path: string): string {
  return `${import.meta.env.BASE_URL}${path}`;
}

export function loadLocalHandedness(): Handedness | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(LOCAL_STORAGE_KEY);
    return isHandedness(raw) ? raw : null;
  } catch {
    return null;
  }
}

export function saveLocalHandedness(value: Handedness): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(LOCAL_STORAGE_KEY, value);
  } catch {
    // Storage full/unavailable -- best-effort, mirrors themeClient.ts.
  }
}

export async function fetchServerHandedness(): Promise<Handedness | null> {
  try {
    const response = await fetch(apiUrl('api/v1/settings'));
    if (!response.ok) return null;
    const body = (await response.json()) as { data: Record<string, unknown> };
    const value = body?.data?.[SETTINGS_KEY] as { value?: unknown } | undefined;
    return isHandedness(value?.value) ? value.value : null;
  } catch {
    return null;
  }
}

export async function patchServerHandedness(value: Handedness): Promise<void> {
  try {
    await fetch(apiUrl('api/v1/settings'), {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ [SETTINGS_KEY]: { value } }),
    });
  } catch {
    // Best-effort -- see doc comment above.
  }
}

/** Boot-time load: local cache first, then the server value once resolved.
 *  Never returns `null` -- callers get `DEFAULT_HANDEDNESS` absent any
 *  persisted choice. */
export async function loadHandedness(): Promise<Handedness> {
  const local = loadLocalHandedness();
  const server = await fetchServerHandedness();
  const resolved = server ?? local ?? DEFAULT_HANDEDNESS;
  saveLocalHandedness(resolved);
  return resolved;
}
