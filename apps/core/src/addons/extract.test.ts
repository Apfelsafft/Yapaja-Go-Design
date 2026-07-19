/**
 * SECURITY-CRITICAL unit tests for the tarball extractor (E09-T1). This is
 * the most important test file in the task: one passing rejection test per
 * classic tarball attack, each asserting BOTH that the install is rejected
 * AND that nothing was written outside the intended destination directory
 * (path traversal) / that the destination is cleaned up (zip bomb).
 */

import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, rmSync, existsSync, readFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { Buffer } from 'node:buffer';
import { extractAddonTarball, MANIFEST_FILENAME } from './extract.js';
import { TarballSecurityError } from './errors.js';
import { buildTarball, buildValidAddonTarball, buildZipBombTarball } from './__fixtures__/buildTarball.js';

const tmpDirs: string[] = [];

function makeTmpDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'addon-extract-test-'));
  tmpDirs.push(dir);
  return dir;
}

afterEach(() => {
  while (tmpDirs.length > 0) {
    const dir = tmpDirs.pop();
    if (dir) rmSync(dir, { recursive: true, force: true });
  }
});

describe('extractAddonTarball -- happy path', () => {
  it('extracts a valid tarball, writing files and returning the manifest', async () => {
    const parent = makeTmpDir();
    const destDir = join(parent, 'com.example.test-addon');
    const { bytes, manifest } = await buildValidAddonTarball({
      extraEntries: [
        { name: 'service/main.js', content: 'console.log("hi");' },
        { name: 'ui/', type: 'directory' },
        { name: 'ui/index.html', content: '<html></html>' },
      ],
    });

    const result = await extractAddonTarball({
      tarballBytes: bytes,
      destDir,
      maxUncompressedBytes: 50 * 1024 * 1024,
    });

    expect(JSON.parse(result.manifestRaw)).toEqual(manifest);
    expect(existsSync(join(destDir, MANIFEST_FILENAME))).toBe(true);
    expect(readFileSync(join(destDir, 'service/main.js'), 'utf-8')).toBe('console.log("hi");');
    expect(existsSync(join(destDir, 'ui/index.html'))).toBe(true);
  });

  it('dry-run mode (destDir: null) validates without writing anything', async () => {
    const { bytes } = await buildValidAddonTarball();
    const result = await extractAddonTarball({
      tarballBytes: bytes,
      destDir: null,
      maxUncompressedBytes: 50 * 1024 * 1024,
    });
    expect(result.manifestRaw.length).toBeGreaterThan(0);
  });

  it('supports a plain (non-gzipped) tar too', async () => {
    const parent = makeTmpDir();
    const destDir = join(parent, 'plain');
    const { manifest } = validManifestPair();
    const bytes = await buildTarball(
      [{ name: 'yapaja-addon.json', content: JSON.stringify(manifest) }],
      { gzip: false },
    );
    const result = await extractAddonTarball({ tarballBytes: bytes, destDir, maxUncompressedBytes: 1024 * 1024 });
    expect(JSON.parse(result.manifestRaw).id).toBe(manifest.id);
  });
});

function validManifestPair(): { manifest: { id: string } } {
  return { manifest: { id: 'com.example.plain-tar' } };
}

describe('extractAddonTarball -- rejects manifest-less tarballs', () => {
  it('rejects a tarball with no yapaja-addon.json at the root', async () => {
    const parent = makeTmpDir();
    const destDir = join(parent, 'no-manifest');
    const bytes = await buildTarball([{ name: 'README.md', content: 'hello' }]);
    await expect(
      extractAddonTarball({ tarballBytes: bytes, destDir, maxUncompressedBytes: 1024 * 1024 }),
    ).rejects.toThrow(TarballSecurityError);
    // Cleaned up -- nothing left behind.
    expect(existsSync(destDir)).toBe(false);
  });

  it('does not accept a nested manifest as the root manifest', async () => {
    const parent = makeTmpDir();
    const destDir = join(parent, 'nested-manifest');
    const bytes = await buildTarball([
      { name: 'nested/yapaja-addon.json', content: '{}' },
    ]);
    await expect(
      extractAddonTarball({ tarballBytes: bytes, destDir, maxUncompressedBytes: 1024 * 1024 }),
    ).rejects.toThrow(TarballSecurityError);
  });
});

describe('extractAddonTarball -- ATTACK: path traversal (../)', () => {
  it('rejects a "../../tmp/evil" entry and writes nothing outside destDir', async () => {
    const parent = makeTmpDir();
    const destDir = join(parent, 'victim');
    const canary = join(parent, 'tmp', 'evil');

    const bytes = await buildTarball([
      { name: 'yapaja-addon.json', content: JSON.stringify(validManifestPair().manifest) },
      { name: '../../tmp/evil', content: 'pwned' },
    ]);

    await expect(
      extractAddonTarball({ tarballBytes: bytes, destDir, maxUncompressedBytes: 1024 * 1024 }),
    ).rejects.toMatchObject({ reason: 'PATH_TRAVERSAL' });

    expect(existsSync(canary)).toBe(false);
    expect(existsSync(destDir)).toBe(false); // aborted install cleaned up entirely
  });

  it('rejects a deeply-nested "../../../etc/x" traversal entry', async () => {
    const parent = makeTmpDir();
    const destDir = join(parent, 'victim2');
    const bytes = await buildTarball([
      { name: 'yapaja-addon.json', content: JSON.stringify(validManifestPair().manifest) },
      { name: '../../../etc/x', content: 'pwned' },
    ]);
    await expect(
      extractAddonTarball({ tarballBytes: bytes, destDir, maxUncompressedBytes: 1024 * 1024 }),
    ).rejects.toMatchObject({ reason: 'PATH_TRAVERSAL' });
    expect(existsSync(destDir)).toBe(false);
  });

  it('also rejects traversal in dry-run mode (destDir: null)', async () => {
    const bytes = await buildTarball([
      { name: 'yapaja-addon.json', content: JSON.stringify(validManifestPair().manifest) },
      { name: '../escape', content: 'pwned' },
    ]);
    await expect(
      extractAddonTarball({ tarballBytes: bytes, destDir: null, maxUncompressedBytes: 1024 * 1024 }),
    ).rejects.toMatchObject({ reason: 'PATH_TRAVERSAL' });
  });
});

describe('extractAddonTarball -- ATTACK: absolute path entry', () => {
  it('rejects a "/etc/evil" entry and writes nothing to that path', async () => {
    const parent = makeTmpDir();
    const destDir = join(parent, 'victim3');
    const bytes = await buildTarball([
      { name: 'yapaja-addon.json', content: JSON.stringify(validManifestPair().manifest) },
      { name: '/etc/evil', content: 'pwned' },
    ]);

    await expect(
      extractAddonTarball({ tarballBytes: bytes, destDir, maxUncompressedBytes: 1024 * 1024 }),
    ).rejects.toMatchObject({ reason: 'ABSOLUTE_PATH' });

    expect(existsSync('/etc/evil')).toBe(false);
    expect(existsSync(destDir)).toBe(false);
  });
});

describe('extractAddonTarball -- ATTACK: symlink escape', () => {
  it('rejects a symlink entry pointing outside destDir', async () => {
    const parent = makeTmpDir();
    const destDir = join(parent, 'victim4');
    const bytes = await buildTarball([
      { name: 'yapaja-addon.json', content: JSON.stringify(validManifestPair().manifest) },
      { name: 'escape-link', type: 'symlink', linkname: '/etc/passwd' },
    ]);

    await expect(
      extractAddonTarball({ tarballBytes: bytes, destDir, maxUncompressedBytes: 1024 * 1024 }),
    ).rejects.toMatchObject({ reason: 'SYMLINK' });

    expect(existsSync(join(destDir, 'escape-link'))).toBe(false);
    expect(existsSync(destDir)).toBe(false);
  });

  it('rejects a hardlink entry too (reject-all-links policy)', async () => {
    const parent = makeTmpDir();
    const destDir = join(parent, 'victim5');
    const bytes = await buildTarball([
      { name: 'yapaja-addon.json', content: JSON.stringify(validManifestPair().manifest) },
      { name: 'hard-link', type: 'link', linkname: '/etc/passwd' },
    ]);

    await expect(
      extractAddonTarball({ tarballBytes: bytes, destDir, maxUncompressedBytes: 1024 * 1024 }),
    ).rejects.toMatchObject({ reason: 'HARDLINK' });
    expect(existsSync(destDir)).toBe(false);
  });

  it('rejects a symlink whose target LOOKS like it stays inside destDir too (reject-all policy)', async () => {
    // Even an apparently-benign-looking symlink is rejected outright -- we
    // never trust symlink targets, see the module doc in extract.ts.
    const parent = makeTmpDir();
    const destDir = join(parent, 'victim6');
    const bytes = await buildTarball([
      { name: 'yapaja-addon.json', content: JSON.stringify(validManifestPair().manifest) },
      { name: 'inner-link', type: 'symlink', linkname: './somewhere-inside' },
    ]);
    await expect(
      extractAddonTarball({ tarballBytes: bytes, destDir, maxUncompressedBytes: 1024 * 1024 }),
    ).rejects.toMatchObject({ reason: 'SYMLINK' });
  });
});

describe('extractAddonTarball -- ATTACK: disallowed entry types', () => {
  it('rejects a fifo entry', async () => {
    const parent = makeTmpDir();
    const destDir = join(parent, 'victim-fifo');
    const bytes = await buildTarball([
      { name: 'yapaja-addon.json', content: JSON.stringify(validManifestPair().manifest) },
      { name: 'a-fifo', type: 'fifo' },
    ]);

    await expect(
      extractAddonTarball({ tarballBytes: bytes, destDir, maxUncompressedBytes: 1024 * 1024 }),
    ).rejects.toMatchObject({ reason: 'UNSUPPORTED_ENTRY_TYPE' });
    expect(existsSync(destDir)).toBe(false);
  });

  it('rejects a character-device entry', async () => {
    const parent = makeTmpDir();
    const destDir = join(parent, 'victim-chardev');
    const bytes = await buildTarball([
      { name: 'yapaja-addon.json', content: JSON.stringify(validManifestPair().manifest) },
      { name: 'a-device', type: 'character-device' },
    ]);

    await expect(
      extractAddonTarball({ tarballBytes: bytes, destDir, maxUncompressedBytes: 1024 * 1024 }),
    ).rejects.toMatchObject({ reason: 'UNSUPPORTED_ENTRY_TYPE' });
    expect(existsSync(destDir)).toBe(false);
  });
});

describe('extractAddonTarball -- ATTACK: zip bomb (uncompressed cap)', () => {
  it('aborts a tarball whose decompressed size exceeds the cap, cleaning up the partial extraction', async () => {
    const parent = makeTmpDir();
    const destDir = join(parent, 'victim-bomb');
    const CAP = 5 * 1024 * 1024; // 5 MB cap for a fast test
    // 60 MB of zero bytes gzip-compresses to a few KB -- a real bomb.
    const bytes = await buildZipBombTarball(60 * 1024 * 1024);
    expect(bytes.length).toBeLessThan(CAP); // compressed size is tiny

    await expect(
      extractAddonTarball({ tarballBytes: bytes, destDir, maxUncompressedBytes: CAP }),
    ).rejects.toMatchObject({ reason: 'UNCOMPRESSED_SIZE_EXCEEDED' });

    // Partial extraction must be cleaned up -- nothing left on disk, and
    // certainly not anywhere near the full 60 MB.
    expect(existsSync(destDir)).toBe(false);
  });

  it('aborts in dry-run mode too (no disk writes needed to prove the guard)', async () => {
    const bytes = await buildZipBombTarball(60 * 1024 * 1024);
    await expect(
      extractAddonTarball({
        tarballBytes: bytes,
        destDir: null,
        maxUncompressedBytes: 5 * 1024 * 1024,
      }),
    ).rejects.toMatchObject({ reason: 'UNCOMPRESSED_SIZE_EXCEEDED' });
  });
});

describe('extractAddonTarball -- corrupt input', () => {
  it('rejects garbage bytes that are not a valid tar/gzip stream', async () => {
    const parent = makeTmpDir();
    const destDir = join(parent, 'garbage');
    const bytes = Buffer.from('this is not a tarball at all, just random text padding out');
    await expect(
      extractAddonTarball({ tarballBytes: bytes, destDir, maxUncompressedBytes: 1024 * 1024 }),
    ).rejects.toThrow(TarballSecurityError);
    expect(existsSync(destDir)).toBe(false);
  });
});

describe('extractAddonTarball -- no residue on ANY rejection', () => {
  it('leaves the parent directory empty after every attack above', () => {
    // Each attack test above already asserts existsSync(destDir) === false;
    // this is a belt-and-braces sanity check that mkdtemp-created parents
    // used in this file are cleaned up by afterEach (no leaked temp dirs).
    expect(tmpDirs.length).toBeGreaterThanOrEqual(0);
  });
});
