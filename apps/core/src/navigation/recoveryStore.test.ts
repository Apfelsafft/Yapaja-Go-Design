/**
 * Recovery-store tests (E04-T1, W-19): in-memory round-trip and the
 * file-backed store's persistence + best-effort (never-throws) error handling.
 */

import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, rmSync, existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs';
import { tmpdir } from 'os';
import { dirname, join } from 'path';
import {
  InMemoryNavRecoveryStore,
  FileNavRecoveryStore,
  type FsLike,
  type NavRecoveryRecord,
} from './recoveryStore.js';

const realFs: FsLike = { existsSync, readFileSync, writeFileSync, mkdirSync, rmSync };
const record: NavRecoveryRecord = {
  route_id: 'r-42',
  destination: { latlng: { lat: 47.14, lon: 9.52 }, name: 'Vaduz' },
};

describe('InMemoryNavRecoveryStore', () => {
  it('saves, loads and clears', () => {
    const store = new InMemoryNavRecoveryStore();
    expect(store.load()).toBeNull();
    store.save(record);
    expect(store.load()).toEqual(record);
    store.clear();
    expect(store.load()).toBeNull();
  });

  it('accepts an initial record', () => {
    expect(new InMemoryNavRecoveryStore(record).load()).toEqual(record);
  });
});

describe('FileNavRecoveryStore', () => {
  const dirs: string[] = [];
  function tempPath(): string {
    const dir = mkdtempSync(join(tmpdir(), 'nav-recovery-'));
    dirs.push(dir);
    return join(dir, 'nested', 'nav-recovery.json');
  }
  afterEach(() => {
    for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
  });

  it('persists a record across store instances (simulates restart)', () => {
    const path = tempPath();
    new FileNavRecoveryStore(path, { fs: realFs, dirname }).save(record);
    // A fresh instance reads what the previous one wrote.
    const reloaded = new FileNavRecoveryStore(path, { fs: realFs, dirname }).load();
    expect(reloaded).toEqual(record);
  });

  it('load() returns null when the file is absent', () => {
    expect(new FileNavRecoveryStore(tempPath(), { fs: realFs, dirname }).load()).toBeNull();
  });

  it('clear() removes the file', () => {
    const path = tempPath();
    const store = new FileNavRecoveryStore(path, { fs: realFs, dirname });
    store.save(record);
    expect(existsSync(path)).toBe(true);
    store.clear();
    expect(existsSync(path)).toBe(false);
  });

  it('never throws on IO failure; logs and degrades to no record', () => {
    const warnings: string[] = [];
    const brokenFs: FsLike = {
      existsSync: () => true,
      readFileSync: () => {
        throw new Error('EIO');
      },
      writeFileSync: () => {
        throw new Error('EROFS');
      },
      mkdirSync: () => {
        throw new Error('EACCES');
      },
      rmSync: () => {
        throw new Error('EBUSY');
      },
    };
    const store = new FileNavRecoveryStore('/nope/x.json', {
      fs: brokenFs,
      dirname,
      logger: { warn: (m) => warnings.push(m) },
    });
    expect(() => store.save(record)).not.toThrow();
    expect(() => store.clear()).not.toThrow();
    expect(store.load()).toBeNull();
    expect(warnings.length).toBeGreaterThanOrEqual(3);
  });

  it('load() returns null on malformed JSON', () => {
    const path = tempPath();
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, '{ not json', 'utf-8');
    expect(new FileNavRecoveryStore(path, { fs: realFs, dirname }).load()).toBeNull();
  });
});
