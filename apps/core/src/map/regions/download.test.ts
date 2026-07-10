import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { Buffer } from 'node:buffer';
import {
  buildRangeHeader,
  computeRemainingBytes,
  existingPartBytes,
  finalFileName,
  partFileName,
  partFilePath,
  finalFilePath,
} from './download.js';

describe('buildRangeHeader (resume offset -> Range header)', () => {
  it('omits the header for a fresh download (no existing bytes)', () => {
    expect(buildRangeHeader(0)).toBeUndefined();
  });

  it('builds an open-ended byte range from the resume offset', () => {
    expect(buildRangeHeader(1)).toBe('bytes=1-');
    expect(buildRangeHeader(1024)).toBe('bytes=1024-');
    expect(buildRangeHeader(123456789)).toBe('bytes=123456789-');
  });
});

describe('computeRemainingBytes', () => {
  it('returns the full size when nothing has been downloaded yet', () => {
    expect(computeRemainingBytes(1000, 0)).toBe(1000);
  });

  it('subtracts the resumed offset from the total', () => {
    expect(computeRemainingBytes(1000, 400)).toBe(600);
  });

  it('never goes negative, even if resumeFrom somehow exceeds the total', () => {
    expect(computeRemainingBytes(1000, 1500)).toBe(0);
  });
});

describe('existingPartBytes', () => {
  const tempDirs: string[] = [];

  afterEach(() => {
    for (const dir of tempDirs.splice(0)) {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('returns 0 when the .part file does not exist', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'yapaja-part-'));
    tempDirs.push(dir);
    expect(await existingPartBytes(join(dir, 'nope.pmtiles.part'))).toBe(0);
  });

  it('returns the exact byte size of an existing .part file', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'yapaja-part-'));
    tempDirs.push(dir);
    const path = join(dir, 'region.pmtiles.part');
    writeFileSync(path, Buffer.alloc(12345));
    expect(await existingPartBytes(path)).toBe(12345);
  });
});

describe('file naming helpers', () => {
  it('derives .part / final names and paths consistently', () => {
    expect(partFileName('germany')).toBe('germany.pmtiles.part');
    expect(finalFileName('germany')).toBe('germany.pmtiles');
    expect(partFilePath('/tiles', 'germany')).toBe(join('/tiles', 'germany.pmtiles.part'));
    expect(finalFilePath('/tiles', 'germany')).toBe(join('/tiles', 'germany.pmtiles'));
  });
});
