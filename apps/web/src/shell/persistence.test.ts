/**
 * Unit tests for the layout-persistence orchestration (E07-T1 Pflicht-Test:
 * "Persistenz-Merge lokal/Server: neuester Zeitstempel gewinnt").
 *
 * Runs under Node (no `window`, see `vitest.config.ts` `environment: 'node'`,
 * same convention as `state/styleStore.test.ts`) -- `loadLocalLayouts`/
 * `saveLocalLayouts` therefore exercise their Node/SSR no-op guard here; the
 * REAL localStorage read/write + reload round-trip is covered by
 * `apps/web/e2e/shell.spec.ts` in a real browser. `fetch` IS available
 * under Node 22 and is stubbed per-test.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { defaultLayout } from './layout.js';
import {
  fetchServerLayouts,
  loadAndReconcileLayouts,
  loadLocalLayouts,
  patchServerLayouts,
  saveLocalLayouts,
} from './persistence.js';

describe('loadLocalLayouts / saveLocalLayouts (Node/SSR guard)', () => {
  it('loadLocalLayouts returns null without a window (Node test env)', () => {
    expect(loadLocalLayouts()).toBeNull();
  });

  it('saveLocalLayouts does not throw without a window', () => {
    expect(() => saveLocalLayouts({ explore: defaultLayout('explore'), drive: defaultLayout('drive') })).not.toThrow();
  });
});

describe('fetchServerLayouts / patchServerLayouts', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('fetchServerLayouts returns the parsed data on success (GET /settings, layouts key)', async () => {
    const serverLayouts = { explore: defaultLayout('explore') };
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve({ data: { layouts: serverLayouts } }) }),
    );
    expect(await fetchServerLayouts()).toEqual(serverLayouts);
  });

  it('fetchServerLayouts returns null when the layouts key was never set (still a 200 with an empty settings map -- never a 404)', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve({ data: {} }) }));
    expect(await fetchServerLayouts()).toBeNull();
  });

  it('fetchServerLayouts returns null on a non-ok response', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false }));
    expect(await fetchServerLayouts()).toBeNull();
  });

  it('fetchServerLayouts returns null (never throws) on a network failure', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')));
    await expect(fetchServerLayouts()).resolves.toBeNull();
  });

  it('patchServerLayouts PATCHes the layouts key and never throws when offline', async () => {
    const fetchMock = vi.fn().mockRejectedValue(new Error('offline'));
    vi.stubGlobal('fetch', fetchMock);
    const layouts = { explore: defaultLayout('explore'), drive: defaultLayout('drive') };
    await expect(patchServerLayouts(layouts)).resolves.toBeUndefined();
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining('api/v1/settings'),
      expect.objectContaining({ method: 'PATCH' }),
    );
  });
});

describe('loadAndReconcileLayouts (newest timestamp wins)', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('picks the server layout when it is newer than any local cache (none under Node) and syncs it back', async () => {
    const newerServerExplore = {
      ...defaultLayout('explore'),
      slots: { ...defaultLayout('explore').slots, 'top-bar': [{ instanceId: 'x', widgetId: 'clock', size: 'S' as const }] },
      updatedAt: 5000,
    };
    const fetchMock = vi.fn().mockImplementation((_url: string, init?: RequestInit) => {
      if (init?.method === 'PATCH') {
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ data: {} }) });
      }
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ data: { layouts: { explore: newerServerExplore } } }),
      });
    });
    vi.stubGlobal('fetch', fetchMock);

    const result = await loadAndReconcileLayouts();
    expect(result.explore).toEqual(newerServerExplore);
    // Reconciliation writes the merged result BACK to the server (PATCH).
    const patchCall = fetchMock.mock.calls.find(([, init]) => init?.method === 'PATCH');
    expect(patchCall).toBeDefined();
  });

  it('falls back to built-in defaults when the server is unreachable and there is no local cache', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')));
    const result = await loadAndReconcileLayouts();
    expect(result.explore).toEqual(defaultLayout('explore'));
    expect(result.drive).toEqual(defaultLayout('drive'));
  });
});
