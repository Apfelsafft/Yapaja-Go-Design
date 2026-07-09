/**
 * Deterministic, in-process generator for minimal PMTiles v3 fixture files.
 *
 * We do NOT ship a committed binary fixture: PMTiles is a compact binary
 * container format, and re-generating it from a small, readable TS module
 * keeps the fixture auditable and avoids binary diffs / .gitignore pitfalls.
 *
 * Only the 127-byte header needs to be spec-correct for our tests, because:
 *  - the regions endpoint (GET /api/v1/map/regions) only reads the header
 *    via the `pmtiles` package's `bytesToHeader()`.
 *  - the tile range endpoint (GET /tiles/:region.pmtiles) streams raw file
 *    bytes and never interprets the PMTiles directory/tile payload.
 *
 * The header layout below mirrors pmtiles@4.4.1's `bytesToHeader()` byte
 * offsets exactly (see node_modules/pmtiles/src/index.ts).
 */

import { mkdtempSync, writeFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
// Explicit import (rather than relying on the ambient Node global) so this
// resolves cleanly under the repo's browser-oriented eslint globals.
import { Buffer } from 'node:buffer';

export const PMTILES_HEADER_SIZE = 127;
// Little-endian uint16 "PM" magic, matches pmtiles' internal check
// (v.getUint16(0, true) === 0x4d50).
const PMTILES_MAGIC_BYTE0 = 0x50; // 'P'
const PMTILES_MAGIC_BYTE1 = 0x4d; // 'M'

export const TILE_TYPE_MVT = 1;
export const COMPRESSION_GZIP = 2;

export interface FixtureHeaderOptions {
  specVersion?: number;
  minZoom?: number;
  maxZoom?: number;
  minLon?: number;
  minLat?: number;
  maxLon?: number;
  maxLat?: number;
  centerZoom?: number;
  centerLon?: number;
  centerLat?: number;
  tileType?: number;
  tileCompression?: number;
  internalCompression?: number;
  clustered?: boolean;
}

export interface FixtureFileOptions extends FixtureHeaderOptions {
  /** Total file size in bytes. Must be >= PMTILES_HEADER_SIZE. Default 20000. */
  totalSize?: number;
}

/**
 * Fixture bounds for a plausible Central-Europe-ish test region, well inside
 * WGS84 bounds ([-180..180] lon, [-90..90] lat).
 */
export const FIXTURE_BOUNDS = {
  minLon: 5.8, // roughly western Germany
  minLat: 47.2,
  maxLon: 15.1,
  maxLat: 55.1,
};

function writeUint64LE(buf: Buffer, offset: number, value: number): void {
  // Fixture values are always small enough to fit in a JS safe integer.
  buf.writeBigUInt64LE(BigInt(value), offset);
}

/**
 * Build a spec-correct 127-byte PMTiles v3 header buffer.
 */
export function buildPMTilesHeader(opts: FixtureHeaderOptions = {}): Buffer {
  const buf = Buffer.alloc(PMTILES_HEADER_SIZE);

  buf.writeUInt8(PMTILES_MAGIC_BYTE0, 0);
  buf.writeUInt8(PMTILES_MAGIC_BYTE1, 1);
  // bytes 2-6 reserved/unused by the reader, left as zero.
  buf.writeUInt8(opts.specVersion ?? 3, 7);

  writeUint64LE(buf, 8, 0); // rootDirectoryOffset
  writeUint64LE(buf, 16, 0); // rootDirectoryLength
  writeUint64LE(buf, 24, 0); // jsonMetadataOffset
  writeUint64LE(buf, 32, 0); // jsonMetadataLength
  writeUint64LE(buf, 40, 0); // leafDirectoryOffset
  writeUint64LE(buf, 48, 0); // leafDirectoryLength
  writeUint64LE(buf, 56, 0); // tileDataOffset
  writeUint64LE(buf, 64, 0); // tileDataLength
  writeUint64LE(buf, 72, 0); // numAddressedTiles
  writeUint64LE(buf, 80, 0); // numTileEntries
  writeUint64LE(buf, 88, 0); // numTileContents

  buf.writeUInt8(opts.clustered ? 1 : 0, 96);
  buf.writeUInt8(opts.internalCompression ?? COMPRESSION_GZIP, 97);
  buf.writeUInt8(opts.tileCompression ?? COMPRESSION_GZIP, 98);
  buf.writeUInt8(opts.tileType ?? TILE_TYPE_MVT, 99);
  buf.writeUInt8(opts.minZoom ?? 0, 100);
  buf.writeUInt8(opts.maxZoom ?? 14, 101);

  buf.writeInt32LE(Math.round((opts.minLon ?? FIXTURE_BOUNDS.minLon) * 1e7), 102);
  buf.writeInt32LE(Math.round((opts.minLat ?? FIXTURE_BOUNDS.minLat) * 1e7), 106);
  buf.writeInt32LE(Math.round((opts.maxLon ?? FIXTURE_BOUNDS.maxLon) * 1e7), 110);
  buf.writeInt32LE(Math.round((opts.maxLat ?? FIXTURE_BOUNDS.maxLat) * 1e7), 114);

  buf.writeUInt8(opts.centerZoom ?? 6, 118);
  buf.writeInt32LE(Math.round((opts.centerLon ?? 10) * 1e7), 119);
  buf.writeInt32LE(Math.round((opts.centerLat ?? 51) * 1e7), 123);

  return buf;
}

/**
 * Build a full fixture file buffer: valid header followed by deterministic
 * filler bytes (repeating index pattern, useful to assert byte-exact range
 * slices in tests) padded out to `totalSize`.
 */
export function buildPMTilesFixtureBuffer(opts: FixtureFileOptions = {}): Buffer {
  const totalSize = opts.totalSize ?? 20000;
  if (totalSize < PMTILES_HEADER_SIZE) {
    throw new Error('totalSize must be >= PMTILES_HEADER_SIZE');
  }
  const header = buildPMTilesHeader(opts);
  const body = Buffer.alloc(totalSize - PMTILES_HEADER_SIZE);
  for (let i = 0; i < body.length; i++) {
    body[i] = i % 251; // deterministic, non-trivial repeating pattern
  }
  return Buffer.concat([header, body]);
}

export interface FixtureDirHandle {
  dir: string;
  cleanup: () => void;
}

/**
 * Create a temp directory and write one or more named `.pmtiles` fixture
 * files into it. Returns the directory path (suitable for TILES_DIR) and a
 * cleanup function to remove it.
 */
export function createFixtureTilesDir(
  files: Record<string, FixtureFileOptions>,
): FixtureDirHandle {
  const dir = mkdtempSync(join(tmpdir(), 'yapaja-pmtiles-fixture-'));
  for (const [region, opts] of Object.entries(files)) {
    const buf = buildPMTilesFixtureBuffer(opts);
    writeFileSync(join(dir, `${region}.pmtiles`), buf);
  }
  return {
    dir,
    cleanup: () => rmSync(dir, { recursive: true, force: true }),
  };
}
