/**
 * Unit tests for the `theme` settings-key client (E07-T3), mirroring
 * `apps/web/src/shell/persistence.test.ts`'s pattern (Node env, `fetch`
 * stubbed per-test; the Node/SSR localStorage no-op guard is exercised
 * directly since there's no `window` here -- the real localStorage
 * round-trip is covered by `apps/web/e2e/theme.spec.ts`).
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  DEFAULT_THEME_MODE,
  fetchAddonDefaultThemeMode,
  fetchServerThemeMode,
  loadLocalThemeMode,
  loadThemeMode,
  patchServerThemeMode,
  saveLocalThemeMode,
} from './themeClient.js';

/**
 * Ein `fetch`, das die BEIDEN Wege unterscheidet.
 *
 * Der frühere Stub gab auf jede Adresse dieselbe Antwort. Damit liess sich
 * „der Server gewinnt" nicht wirklich zeigen: die Vorgabe-Adresse lieferte ja
 * denselben Wert. Erst wenn die Wege verschiedene Werte liefern, sagt ein
 * Ergebnis etwas über die Rangfolge aus.
 */
function fetchNachWeg(antworten: { settings?: unknown; defaults?: unknown }) {
  return vi.fn((url: string) => {
    const koerper = url.endsWith('/defaults') ? antworten.defaults : antworten.settings;
    if (koerper === undefined) return Promise.resolve({ ok: false, json: () => Promise.resolve({}) });
    return Promise.resolve({ ok: true, json: () => Promise.resolve(koerper) });
  });
}

/** Ein `window` mit echtem Speicher -- die Tests laufen ohne Browser. */
function stubWindowMitSpeicher(anfangswert: string | null): Map<string, string> {
  const speicher = new Map<string, string>();
  if (anfangswert !== null) speicher.set('yapaja.theme.mode', anfangswert);
  vi.stubGlobal('window', {
    localStorage: {
      getItem: (k: string) => speicher.get(k) ?? null,
      setItem: (k: string, v: string) => void speicher.set(k, v),
    },
  });
  return speicher;
}

describe('loadLocalThemeMode / saveLocalThemeMode (Node/SSR guard)', () => {
  it('loadLocalThemeMode returns null without a window (Node test env)', () => {
    expect(loadLocalThemeMode()).toBeNull();
  });

  it('saveLocalThemeMode does not throw without a window', () => {
    expect(() => saveLocalThemeMode('dark')).not.toThrow();
  });
});

describe('fetchServerThemeMode / patchServerThemeMode', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('returns the parsed mode on success (GET /settings, theme key)', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve({ data: { theme: { mode: 'dark' } } }) }),
    );
    expect(await fetchServerThemeMode()).toBe('dark');
  });

  it('returns null when the theme key was never set (still a 200 with an empty settings map)', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve({ data: {} }) }));
    expect(await fetchServerThemeMode()).toBeNull();
  });

  it('returns null for a malformed/unknown mode value (never trusts an unvalidated string)', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve({ data: { theme: { mode: 'purple' } } }) }),
    );
    expect(await fetchServerThemeMode()).toBeNull();
  });

  it('returns null on a non-ok response', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false }));
    expect(await fetchServerThemeMode()).toBeNull();
  });

  it('returns null (never throws) on a network failure', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')));
    await expect(fetchServerThemeMode()).resolves.toBeNull();
  });

  it('patchServerThemeMode PATCHes the theme key and never throws when offline', async () => {
    const fetchMock = vi.fn().mockRejectedValue(new Error('offline'));
    vi.stubGlobal('fetch', fetchMock);
    await expect(patchServerThemeMode('light')).resolves.toBeUndefined();
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining('api/v1/settings'),
      expect.objectContaining({ method: 'PATCH', body: JSON.stringify({ theme: { mode: 'light' } }) }),
    );
  });
});

describe('fetchAddonDefaultThemeMode (die Add-on-Vorgabe)', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('liest den Modus aus GET /settings/defaults', async () => {
    const f = fetchNachWeg({ defaults: { data: { theme: { mode: 'system' } } } });
    vi.stubGlobal('fetch', f);
    expect(await fetchAddonDefaultThemeMode()).toBe('system');
    expect(f).toHaveBeenCalledWith(expect.stringContaining('api/v1/settings/defaults'));
  });

  it('ist null, wenn das Add-on keine Vorgabe macht (Standalone-Betrieb)', async () => {
    vi.stubGlobal('fetch', fetchNachWeg({ defaults: { data: { theme: null } } }));
    expect(await fetchAddonDefaultThemeMode()).toBeNull();
  });

  it('ist null bei einem unbekannten Wert -- eine Option ist ein frei getippter String', async () => {
    vi.stubGlobal('fetch', fetchNachWeg({ defaults: { data: { theme: { mode: 'sun' } } } }));
    expect(await fetchAddonDefaultThemeMode()).toBeNull();
  });

  it('ist null (wirft nie), wenn es die Adresse nicht gibt -- ältere Kerne kennen sie nicht', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')));
    await expect(fetchAddonDefaultThemeMode()).resolves.toBeNull();
  });
});

describe('loadThemeMode -- die Rangfolge', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('1. die Wahl in Yapaia schlägt Add-on-Vorgabe UND Gerätespeicher', async () => {
    stubWindowMitSpeicher('light');
    vi.stubGlobal(
      'fetch',
      fetchNachWeg({
        settings: { data: { theme: { mode: 'dark' } } },
        defaults: { data: { theme: { mode: 'system' } } },
      }),
    );
    expect(await loadThemeMode()).toBe('dark');
  });

  it('2. ohne eigene Wahl gilt die Add-on-Vorgabe -- auch wenn das Gerät schon etwas gespeichert hat', async () => {
    stubWindowMitSpeicher('light');
    vi.stubGlobal(
      'fetch',
      fetchNachWeg({ settings: { data: {} }, defaults: { data: { theme: { mode: 'dark' } } } }),
    );
    expect(await loadThemeMode()).toBe('dark');
  });

  it('3. ohne Vorgabe gilt der Gerätespeicher', async () => {
    stubWindowMitSpeicher('system');
    vi.stubGlobal('fetch', fetchNachWeg({ settings: { data: {} }, defaults: { data: { theme: null } } }));
    expect(await loadThemeMode()).toBe('system');
  });

  it('4. sonst die eingebaute Vorgabe', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')));
    expect(await loadThemeMode()).toBe(DEFAULT_THEME_MODE);
  });

  it('schreibt das Ergebnis in den Gerätespeicher, damit der nächste Start ohne Kern stimmt', async () => {
    const speicher = stubWindowMitSpeicher(null);
    vi.stubGlobal(
      'fetch',
      fetchNachWeg({ settings: { data: {} }, defaults: { data: { theme: { mode: 'dark' } } } }),
    );
    await loadThemeMode();
    expect(speicher.get('yapaja.theme.mode')).toBe('dark');
  });
});
