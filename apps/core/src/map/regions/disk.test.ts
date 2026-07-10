import { describe, it, expect } from 'vitest';
import { checkDiskSpace, DISK_SAFETY_MARGIN_BYTES } from './disk.js';

describe('checkDiskSpace (W-18 disk-full pre-check)', () => {
  it('allows a download that fits comfortably within free space minus the 1GB margin', async () => {
    const statfsFn = async () => ({ bavail: 10_000_000, bsize: 1024 }); // ~10.24 GB free
    const result = await checkDiskSpace('/tiles', 1_000_000_000, statfsFn); // need 1GB
    expect(result.ok).toBe(true);
    expect(result.freeBytes).toBe(10_000_000 * 1024);
    expect(result.requiredBytes).toBe(1_000_000_000);
  });

  it('refuses when required bytes exceed free space minus the safety margin', async () => {
    // ~1.5 GB free, need 1 GB -> after the 1GB margin only ~0.5GB usable.
    const statfsFn = async () => ({ bavail: 366211, bsize: 4096 }); // ~1.5 GB
    const result = await checkDiskSpace('/tiles', 1_000_000_000, statfsFn);
    expect(result.ok).toBe(false);
    expect(result.requiredBytes).toBe(1_000_000_000);
  });

  it('is exact at the boundary: required === free - margin passes, +1 byte fails', async () => {
    const bsize = 1;
    const bavail = 2_000_000_000; // 2,000,000,000 bytes free
    const required = 2_000_000_000 - DISK_SAFETY_MARGIN_BYTES; // exactly at the line
    const statfsFn = async () => ({ bavail, bsize });

    const atLimit = await checkDiskSpace('/tiles', required, statfsFn);
    expect(atLimit.ok).toBe(true);

    const overLimit = await checkDiskSpace('/tiles', required + 1, statfsFn);
    expect(overLimit.ok).toBe(false);
  });

  it('uses the injected statfsFn rather than a hardcoded value (no real syscall)', async () => {
    let called = false;
    const statfsFn = async (path: string) => {
      called = true;
      expect(path).toBe('/some/tiles/dir');
      return { bavail: 5000, bsize: 4096 };
    };
    await checkDiskSpace('/some/tiles/dir', 1, statfsFn);
    expect(called).toBe(true);
  });
});
