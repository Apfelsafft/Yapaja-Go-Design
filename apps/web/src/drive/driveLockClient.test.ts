/**
 * Unit tests for the `driveLock` settings-key client (E07-T4), mirroring
 * `apps/web/src/theme/themeClient.test.ts`'s pattern (Node env, `fetch`
 * stubbed per-test; Node/SSR localStorage no-op guard exercised directly).
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { DEFAULT_DRIVE_LOCK_KMH } from './driveLock.js';
import {
  fetchServerDriveLockThresholdKmh,
  loadDriveLockThresholdKmh,
  loadLocalDriveLockThresholdKmh,
  patchServerDriveLockThresholdKmh,
  saveLocalDriveLockThresholdKmh,
} from './driveLockClient.js';

describe('loadLocalDriveLockThresholdKmh / saveLocalDriveLockThresholdKmh (Node/SSR guard)', () => {
  it('returns null without a window (Node test env)', () => {
    expect(loadLocalDriveLockThresholdKmh()).toBeNull();
  });

  it('does not throw without a window', () => {
    expect(() => saveLocalDriveLockThresholdKmh(15)).not.toThrow();
  });
});

describe('fetchServerDriveLockThresholdKmh / patchServerDriveLockThresholdKmh', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('returns the parsed threshold on success (GET /settings, driveLock key)', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve({ data: { driveLock: { thresholdKmh: 15 } } }) }),
    );
    expect(await fetchServerDriveLockThresholdKmh()).toBe(15);
  });

  it('returns null when the driveLock key was never set (still a 200 with an empty settings map)', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve({ data: {} }) }));
    expect(await fetchServerDriveLockThresholdKmh()).toBeNull();
  });

  it('returns null for a malformed value (never trusts an unvalidated payload)', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ data: { driveLock: { thresholdKmh: 'fast' } } }),
      }),
    );
    expect(await fetchServerDriveLockThresholdKmh()).toBeNull();
  });

  it('returns null for a negative threshold (rejected as invalid)', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ data: { driveLock: { thresholdKmh: -5 } } }),
      }),
    );
    expect(await fetchServerDriveLockThresholdKmh()).toBeNull();
  });

  it('returns null on a non-ok response', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false }));
    expect(await fetchServerDriveLockThresholdKmh()).toBeNull();
  });

  it('returns null (never throws) on a network failure', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')));
    await expect(fetchServerDriveLockThresholdKmh()).resolves.toBeNull();
  });

  it('patchServerDriveLockThresholdKmh PATCHes the driveLock key and never throws when offline', async () => {
    const fetchMock = vi.fn().mockRejectedValue(new Error('offline'));
    vi.stubGlobal('fetch', fetchMock);
    await expect(patchServerDriveLockThresholdKmh(20)).resolves.toBeUndefined();
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining('api/v1/settings'),
      expect.objectContaining({ method: 'PATCH', body: JSON.stringify({ driveLock: { thresholdKmh: 20 } }) }),
    );
  });
});

describe('loadDriveLockThresholdKmh', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('prefers the server value when reachable', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve({ data: { driveLock: { thresholdKmh: 25 } } }) }),
    );
    expect(await loadDriveLockThresholdKmh()).toBe(25);
  });

  it('falls back to the built-in default when the server is unreachable and there is no local cache (Node test env)', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')));
    expect(await loadDriveLockThresholdKmh()).toBe(DEFAULT_DRIVE_LOCK_KMH);
  });
});
