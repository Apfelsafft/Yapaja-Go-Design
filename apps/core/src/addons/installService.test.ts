/**
 * Unit tests for the install/lifecycle pipeline orchestration (E09-T1):
 * the two-step scope-confirm flow, sha256 verification, the `core_api`
 * semver check, update-with-rollback, and residue-free uninstall.
 *
 * Uses a real (in-memory) migrated DB (`createDb(':memory:')`, which runs
 * the full migration list including `002_addons`) and a real temp directory
 * for `addonsRootDir`/`addonsStorageRootDir` -- this is a service-level
 * test (no HTTP), `routes.test.ts` covers the same flows through
 * `server.inject()`.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, existsSync, readFileSync, mkdirSync, writeFileSync, readdirSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { createHash } from 'crypto';
import { Buffer } from 'node:buffer';
import { createDb } from '../db/index.js';
import { AddonRepository } from './repository.js';
import { InstallService } from './installService.js';
import { AddonError } from './errors.js';
import { AddonStorageService, type AddonStorageSettings } from './storageService.js';
import { buildTarball, buildValidAddonTarball, buildZipBombTarball } from './__fixtures__/buildTarball.js';

/** In-memory settings fake -- same shape `storageService.test.ts` uses.
 *  Standing in for the settings-table-backed `addon.storage.{id}` KV
 *  namespace so these tests never touch the process-global `getDb()`
 *  singleton (the default `AddonStorageService()` would otherwise open a
 *  real `data/db/yapaja.db` relative to the process cwd -- not this test's
 *  isolated in-memory `db`). */
function makeFakeStorageSettings(): AddonStorageSettings & { store: Record<string, unknown> } {
  const store: Record<string, unknown> = {};
  return {
    store,
    get: (key) => store[key],
    patch: (values) => {
      Object.assign(store, values);
      return { ...store };
    },
  };
}

let addonsRootDir: string;
let addonsStorageRootDir: string;
let db: ReturnType<typeof createDb>;
let service: InstallService;
let fakeStorageSettings: ReturnType<typeof makeFakeStorageSettings>;

beforeEach(() => {
  const parent = mkdtempSync(join(tmpdir(), 'addon-install-service-test-'));
  addonsRootDir = join(parent, 'addons');
  addonsStorageRootDir = join(parent, 'addon-storage');
  db = createDb(':memory:');
  fakeStorageSettings = makeFakeStorageSettings();
  service = new InstallService({
    repository: new AddonRepository(db),
    coreVersion: '1.4.0',
    addonsRootDir,
    addonsStorageRootDir,
    maxCompressedBytes: 50 * 1024 * 1024,
    maxUncompressedBytes: 50 * 1024 * 1024,
    addonStorage: new AddonStorageService(fakeStorageSettings),
  });
});

afterEach(() => {
  db.close();
  const parent = join(addonsRootDir, '..');
  rmSync(parent, { recursive: true, force: true });
});

describe('two-step scope-confirm install flow', () => {
  it('a valid tarball installs through beginInstall -> confirmInstall, disabled by default', async () => {
    const { bytes, manifest } = await buildValidAddonTarball({
      manifest: { core_api: '^1.0' },
      extraEntries: [{ name: 'service/main.js', content: 'x' }],
    });

    const pending = await service.beginInstallFromUpload(bytes);
    expect(pending.manifest.id).toBe(manifest.id);
    expect(pending.isUpdate).toBe(false);
    // Nothing installed yet.
    expect(service.listAddons()).toEqual([]);
    expect(existsSync(join(addonsRootDir, manifest.id))).toBe(false);

    const record = await service.confirmInstall(pending.pendingId);
    expect(record.id).toBe(manifest.id);
    expect(record.version).toBe(manifest.version);
    expect(record.enabled).toBe(false); // install != active (E09-T1 plausibility)
    expect(existsSync(join(addonsRootDir, manifest.id, 'yapaja-addon.json'))).toBe(true);
    expect(existsSync(join(addonsRootDir, manifest.id, 'service/main.js'))).toBe(true);
    expect(service.listAddons()).toHaveLength(1);
  });

  it('confirming an unknown/expired pendingId is rejected', async () => {
    await expect(service.confirmInstall('does-not-exist')).rejects.toMatchObject({
      code: 'PENDING_NOT_FOUND',
    });
  });

  it('a pending token is single-use -- confirming twice fails the second time', async () => {
    const { bytes } = await buildValidAddonTarball();
    const pending = await service.beginInstallFromUpload(bytes);
    await service.confirmInstall(pending.pendingId);
    await expect(service.confirmInstall(pending.pendingId)).rejects.toMatchObject({
      code: 'PENDING_NOT_FOUND',
    });
  });

  it('flags the dangerous nav.control + net.fetch combination as a warning, not a rejection', async () => {
    const { bytes } = await buildValidAddonTarball({
      manifest: { permissions: ['nav.control', 'net.fetch:api.example.com'] },
    });
    const pending = await service.beginInstallFromUpload(bytes);
    expect(pending.warnings.length).toBeGreaterThan(0);
    expect(pending.warnings[0]).toMatch(/nav\.control/);
    // Still installable -- warnings don't block.
    await expect(service.confirmInstall(pending.pendingId)).resolves.toBeTruthy();
  });
});

describe('sha256 verification', () => {
  it('an upload with a MATCHING sha256 succeeds', async () => {
    const { bytes } = await buildValidAddonTarball();
    const digest = createHash('sha256').update(bytes).digest('hex');
    await expect(service.beginInstallFromUpload(bytes, digest)).resolves.toBeTruthy();
  });

  it('an upload with a MISMATCHED sha256 is rejected', async () => {
    const { bytes } = await buildValidAddonTarball();
    await expect(service.beginInstallFromUpload(bytes, 'a'.repeat(64))).rejects.toMatchObject({
      code: 'SHA256_MISMATCH',
    });
  });

  it('an upload with NO sha256 is accepted (optional for uploads)', async () => {
    const { bytes } = await buildValidAddonTarball();
    await expect(service.beginInstallFromUpload(bytes)).resolves.toBeTruthy();
  });

  it('a URL install with NO sha256 is rejected (mandatory for URL/registry installs)', async () => {
    const { bytes } = await buildValidAddonTarball();
    await expect(service.beginInstallFromUrl(bytes, '')).rejects.toMatchObject({
      code: 'SHA256_REQUIRED',
    });
  });

  it('a URL install with a matching sha256 succeeds', async () => {
    const { bytes } = await buildValidAddonTarball();
    const digest = createHash('sha256').update(bytes).digest('hex');
    await expect(service.beginInstallFromUrl(bytes, digest)).resolves.toBeTruthy();
  });
});

describe('core_api semver compatibility (Wargame W-11)', () => {
  it('rejects an add-on whose core_api range does not cover the running Core version, with a clear message', async () => {
    const { bytes, manifest } = await buildValidAddonTarball({ manifest: { core_api: '^99.0' } });
    await expect(service.beginInstallFromUpload(bytes)).rejects.toMatchObject({
      code: 'INCOMPATIBLE_CORE_API',
      message: expect.stringContaining('99.0'),
    });
    void manifest;
    // Message names both the required range and the actual Core version.
    try {
      await service.beginInstallFromUpload(bytes);
      expect.unreachable();
    } catch (err) {
      expect((err as AddonError).message).toContain('1.4.0');
    }
  });

  it('accepts an add-on whose core_api range covers the running Core version', async () => {
    const { bytes } = await buildValidAddonTarball({ manifest: { core_api: '^1.0' } });
    await expect(service.beginInstallFromUpload(bytes)).resolves.toBeTruthy();
  });
});

describe('malicious tarballs are rejected at step 1 (before anything is written)', () => {
  it('rejects a path-traversal tarball', async () => {
    const bytes = await buildTarball([
      { name: 'yapaja-addon.json', content: JSON.stringify({ id: 'x' }) },
      { name: '../../tmp/evil', content: 'pwned' },
    ]);
    await expect(service.beginInstallFromUpload(bytes)).rejects.toMatchObject({ code: 'TARBALL_REJECTED' });
    expect(existsSync(addonsRootDir)).toBe(false);
  });

  it('rejects an absolute-path tarball', async () => {
    const bytes = await buildTarball([
      { name: 'yapaja-addon.json', content: JSON.stringify({ id: 'x' }) },
      { name: '/etc/evil', content: 'pwned' },
    ]);
    await expect(service.beginInstallFromUpload(bytes)).rejects.toMatchObject({ code: 'TARBALL_REJECTED' });
  });

  it('rejects a tarball with a symlink entry', async () => {
    const bytes = await buildTarball([
      { name: 'yapaja-addon.json', content: JSON.stringify({ id: 'x' }) },
      { name: 'escape', type: 'symlink', linkname: '/etc/passwd' },
    ]);
    await expect(service.beginInstallFromUpload(bytes)).rejects.toMatchObject({ code: 'TARBALL_REJECTED' });
  });

  it('rejects a zip-bomb tarball', async () => {
    const smallCapService = new InstallService({
      repository: new AddonRepository(db),
      coreVersion: '1.4.0',
      addonsRootDir,
      addonsStorageRootDir,
      maxUncompressedBytes: 5 * 1024 * 1024,
    });
    const bytes = await buildZipBombTarball(60 * 1024 * 1024);
    await expect(smallCapService.beginInstallFromUpload(bytes)).rejects.toMatchObject({
      code: 'TARBALL_REJECTED',
    });
  });
});

describe('update with rollback (docs/05 §5)', () => {
  async function installV1(): Promise<{ id: string }> {
    const { bytes, manifest } = await buildValidAddonTarball({
      manifest: { version: '1.0.0', core_api: '^1.0' },
      extraEntries: [{ name: 'service/main.js', content: 'v1' }],
    });
    const pending = await service.beginInstallFromUpload(bytes);
    await service.confirmInstall(pending.pendingId);
    return { id: manifest.id };
  }

  it('a successful update swaps the directory and bumps the DB version, preserving `enabled`', async () => {
    const { id } = await installV1();
    service.enable(id);
    expect(service.listAddons()[0].enabled).toBe(true);

    const { bytes: v2Bytes } = await buildValidAddonTarball({
      manifest: { version: '2.0.0', core_api: '^1.0' },
      extraEntries: [{ name: 'service/main.js', content: 'v2' }],
    });
    const pending = await service.beginInstallFromUpload(v2Bytes);
    expect(pending.isUpdate).toBe(true);
    const record = await service.confirmInstall(pending.pendingId);

    expect(record.version).toBe('2.0.0');
    expect(record.enabled).toBe(true); // preserved across update
    expect(readFileSync(join(addonsRootDir, id, 'service/main.js'), 'utf-8')).toBe('v2');
  });

  it('a failing update (declared entry missing -- "does not start") leaves the PREVIOUS version intact', async () => {
    const { id } = await installV1();
    const before = service.listAddons()[0];
    expect(before.version).toBe('1.0.0');

    // v2's manifest declares service.entry = service/main.js, but the
    // tarball doesn't actually contain that file -- the post-extraction
    // "does this look startable" check must reject this and roll back.
    const { bytes: brokenV2 } = await buildValidAddonTarball({
      manifest: { version: '2.0.0', core_api: '^1.0', service: { runtime: 'node18', entry: 'service/main.js' } },
      extraEntries: [], // service/main.js deliberately NOT included
    });

    const pending = await service.beginInstallFromUpload(brokenV2);
    await expect(service.confirmInstall(pending.pendingId)).rejects.toMatchObject({
      code: 'ADDON_START_FAILED',
    });

    // Old version untouched on disk...
    expect(readFileSync(join(addonsRootDir, id, 'service/main.js'), 'utf-8')).toBe('v1');
    const manifestOnDisk = JSON.parse(readFileSync(join(addonsRootDir, id, 'yapaja-addon.json'), 'utf-8'));
    expect(manifestOnDisk.version).toBe('1.0.0');
    // ...and untouched in the DB.
    const after = service.listAddons()[0];
    expect(after.version).toBe('1.0.0');
    // No leaked staging SUBDIRECTORY for this failed attempt (the `.staging`
    // root itself may still exist -- it's created once, up front -- but it
    // must be empty).
    const stagingRoot = join(addonsRootDir, '.staging');
    if (existsSync(stagingRoot)) {
      expect(readdirSync(stagingRoot)).toEqual([]);
    }
  });

  it('a fresh install (not an update) that fails to start leaves NOTHING installed', async () => {
    const { bytes } = await buildValidAddonTarball({
      manifest: { service: { runtime: 'node18', entry: 'service/main.js' } },
      extraEntries: [],
    });
    const pending = await service.beginInstallFromUpload(bytes);
    await expect(service.confirmInstall(pending.pendingId)).rejects.toMatchObject({
      code: 'ADDON_START_FAILED',
    });
    expect(service.listAddons()).toEqual([]);
  });
});

describe('enable/disable lifecycle', () => {
  it('toggles the DB `enabled` flag -- the single source of truth for "is this add-on active"', async () => {
    const { bytes, manifest } = await buildValidAddonTarball();
    const pending = await service.beginInstallFromUpload(bytes);
    await service.confirmInstall(pending.pendingId);

    expect(service.listAddons()[0].enabled).toBe(false);
    const enabled = service.enable(manifest.id);
    expect(enabled.enabled).toBe(true);
    const disabled = service.disable(manifest.id);
    expect(disabled.enabled).toBe(false);
  });

  it('enable/disable on an unknown id is rejected', () => {
    expect(() => service.enable('nope')).toThrow(AddonError);
    expect(() => service.disable('nope')).toThrow(AddonError);
  });
});

describe('uninstall -- residue-free (FS + settings-KV + DB) -- E09-T7 plausibility check', () => {
  it('removes the code dir, the FS storage dir, the settings-backed KV namespace, and the DB row completely', async () => {
    const { bytes, manifest } = await buildValidAddonTarball();
    const pending = await service.beginInstallFromUpload(bytes);
    await service.confirmInstall(pending.pendingId);
    service.enable(manifest.id);

    // Simulate the add-on having written something to its own storage dir
    // (storage.own scope) -- uninstall must wipe this too.
    const storageDir = join(addonsStorageRootDir, manifest.id);
    mkdirSync(storageDir, { recursive: true });
    writeFileSync(join(storageDir, 'state.json'), '{"foo":1}');

    // TWO storages exist for `storage.own` (docs/05 §2): the filesystem dir
    // above, AND the settings-table-backed KV namespace `addon.storage.{id}`
    // that `storageRoutes.ts`/`AddonStorageService` actually serve
    // `GET/PUT/DELETE /addons/:id/storage/:key` from. Simulate the add-on
    // having used THAT one too.
    const kvService = new AddonStorageService(fakeStorageSettings);
    kvService.set(manifest.id, 'lastSync', 42);

    expect(existsSync(join(addonsRootDir, manifest.id))).toBe(true);
    expect(existsSync(storageDir)).toBe(true);
    expect(fakeStorageSettings.store[`addon.storage.${manifest.id}`]).toEqual({ lastSync: 42 });
    expect(service.listAddons()).toHaveLength(1);

    await service.uninstall(manifest.id);

    expect(existsSync(join(addonsRootDir, manifest.id))).toBe(false);
    expect(existsSync(storageDir)).toBe(false);
    // BUGFIX under test: before E09-T7 this key survived an uninstall
    // forever (see `installService.ts`'s `AddonStorageClearer` doc comment).
    expect(kvService.get(manifest.id, 'lastSync')).toBeUndefined();
    expect(fakeStorageSettings.store[`addon.storage.${manifest.id}`]).toEqual({});
    expect(service.listAddons()).toEqual([]);
    // Direct DB check too, not just the service-level view.
    expect(new AddonRepository(db).getById(manifest.id)).toBeNull();
  });

  it('uninstalling an unknown id is rejected', async () => {
    await expect(service.uninstall('nope')).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });
});

describe('update preserves BOTH storages -- only uninstall wipes them (docs/05 §5, E09-T7 plausibility check)', () => {
  it('an update (same id, new version) leaves the FS storage dir AND the settings-KV namespace untouched', async () => {
    const { bytes: v1Bytes, manifest } = await buildValidAddonTarball({
      manifest: { version: '1.0.0', core_api: '^1.0' },
    });
    const v1Pending = await service.beginInstallFromUpload(v1Bytes);
    await service.confirmInstall(v1Pending.pendingId);
    service.enable(manifest.id);

    // The add-on writes to BOTH of its storages while running v1.
    const storageDir = join(addonsStorageRootDir, manifest.id);
    mkdirSync(storageDir, { recursive: true });
    writeFileSync(join(storageDir, 'settings.json'), '{"unit":"metric"}');
    const kvService = new AddonStorageService(fakeStorageSettings);
    kvService.set(manifest.id, 'apiKey', 'user-configured-secret');

    // Update to v2.
    const { bytes: v2Bytes } = await buildValidAddonTarball({
      manifest: { version: '2.0.0', core_api: '^1.0' },
    });
    const v2Pending = await service.beginInstallFromUpload(v2Bytes);
    expect(v2Pending.isUpdate).toBe(true);
    const record = await service.confirmInstall(v2Pending.pendingId);
    expect(record.version).toBe('2.0.0');

    // Both storages -- FS dir and settings-KV namespace -- survive an
    // update byte-for-byte; `confirmInstall`'s swap only ever touches the
    // CODE dir (`resolveAddonDir(addonsRootDir, id)`), never
    // `addonsStorageRootDir` or the settings table.
    expect(readFileSync(join(storageDir, 'settings.json'), 'utf-8')).toBe('{"unit":"metric"}');
    expect(kvService.get(manifest.id, 'apiKey')).toBe('user-configured-secret');

    // Only uninstall wipes them (cross-checked against the describe block
    // above, repeated here to nail down the "only" half of the claim).
    await service.uninstall(manifest.id);
    expect(existsSync(storageDir)).toBe(false);
    expect(kvService.get(manifest.id, 'apiKey')).toBeUndefined();
  });
});

describe('size caps', () => {
  it('rejects a tarball larger than the compressed-size cap', async () => {
    const smallCapService = new InstallService({
      repository: new AddonRepository(db),
      coreVersion: '1.4.0',
      addonsRootDir,
      addonsStorageRootDir,
      maxCompressedBytes: 100,
    });
    const { bytes } = await buildValidAddonTarball({
      extraEntries: [{ name: 'padding.bin', content: Buffer.alloc(1000, 1) }],
    });
    expect(bytes.length).toBeGreaterThan(100);
    await expect(smallCapService.beginInstallFromUpload(bytes)).rejects.toMatchObject({
      code: 'TARBALL_TOO_LARGE',
    });
  });
});
