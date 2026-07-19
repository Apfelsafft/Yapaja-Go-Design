import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { getSystemResources } from './resources.js';

describe('getSystemResources (E08-T5, W-12/W-18 plausibility)', () => {
  const tempDirs: string[] = [];

  afterEach(() => {
    for (const dir of tempDirs.splice(0)) {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('derives disk_free_bytes/disk_total_bytes from the injected statfs (bavail/blocks * bsize)', async () => {
    const statfsFn = async (path: string) => {
      expect(path).toBe('/some/data/dir');
      return { bavail: 500_000, blocks: 2_000_000, bsize: 4096 };
    };

    const result = await getSystemResources('/some/data/dir', {
      statfsFn,
      freeMemFn: () => 1_000_000,
      totalMemFn: () => 8_000_000,
    });

    expect(result.disk_free_bytes).toBe(500_000 * 4096);
    expect(result.disk_total_bytes).toBe(2_000_000 * 4096);
  });

  it('derives mem_free_bytes/mem_total_bytes from the injected os.freemem/totalmem', async () => {
    const result = await getSystemResources('/some/data/dir', {
      statfsFn: async () => ({ bavail: 1, blocks: 1, bsize: 1 }),
      freeMemFn: () => 123_456,
      totalMemFn: () => 987_654,
    });

    expect(result.mem_free_bytes).toBe(123_456);
    expect(result.mem_total_bytes).toBe(987_654);
  });

  it('uses the injected functions rather than hardcoded values -- different inputs produce different outputs', async () => {
    const low = await getSystemResources('/x', {
      statfsFn: async () => ({ bavail: 100, blocks: 1000, bsize: 1024 }),
      freeMemFn: () => 1,
      totalMemFn: () => 2,
    });
    const high = await getSystemResources('/x', {
      statfsFn: async () => ({ bavail: 999_999, blocks: 9_999_999, bsize: 1024 }),
      freeMemFn: () => 999,
      totalMemFn: () => 1000,
    });

    expect(low.disk_free_bytes).not.toBe(high.disk_free_bytes);
    expect(low.disk_total_bytes).not.toBe(high.disk_total_bytes);
    expect(low.mem_free_bytes).not.toBe(high.mem_free_bytes);
    expect(low.mem_total_bytes).not.toBe(high.mem_total_bytes);
  });

  it('creates dataDir if missing (so a fresh install with no tiles yet does not ENOENT) and then reports real statfs of it', async () => {
    const parent = mkdtempSync(join(tmpdir(), 'yapaja-resources-'));
    tempDirs.push(parent);
    const missingDir = join(parent, 'not-yet-created', 'nested');

    // Real (un-mocked) statfsFn -- proves this genuinely calls the OS, not a stub.
    const result = await getSystemResources(missingDir);

    expect(result.disk_free_bytes).toBeGreaterThan(0);
    expect(result.disk_total_bytes).toBeGreaterThanOrEqual(result.disk_free_bytes);
    expect(result.mem_free_bytes).toBeGreaterThan(0);
    expect(result.mem_total_bytes).toBeGreaterThan(0);
  });
});
