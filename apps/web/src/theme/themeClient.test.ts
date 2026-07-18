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
  fetchServerThemeMode,
  loadLocalThemeMode,
  loadThemeMode,
  patchServerThemeMode,
  saveLocalThemeMode,
} from './themeClient.js';

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

describe('loadThemeMode', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('prefers the server value when reachable', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve({ data: { theme: { mode: 'dark' } } }) }),
    );
    expect(await loadThemeMode()).toBe('dark');
  });

  it('falls back to the built-in default when the server is unreachable and there is no local cache (Node test env)', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')));
    expect(await loadThemeMode()).toBe(DEFAULT_THEME_MODE);
  });
});
