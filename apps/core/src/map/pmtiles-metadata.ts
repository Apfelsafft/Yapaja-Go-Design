/**
 * Reads PMTiles v3 header metadata directly from a local file (no HTTP),
 * using the `pmtiles` package's pure header parser (`bytesToHeader`).
 *
 * We deliberately avoid the package's `PMTiles`/`Source` abstractions (they
 * are designed for HTTP/browser range-fetch sources) and instead read the
 * first bytes of the file ourselves, which is simpler and sufficient: we
 * only need header fields (bounds, zoom range, tile type/compression), not
 * the tile directory.
 */

import { open } from 'fs/promises';
// Explicit import (rather than relying on the ambient Node global) so this
// resolves cleanly under the repo's browser-oriented eslint globals.
import { Buffer } from 'node:buffer';
import { Compression, TileType, bytesToHeader, type Header } from 'pmtiles';

// Matches HEADER_SIZE_BYTES in pmtiles' internal implementation.
const HEADER_SIZE_BYTES = 127;
// Little-endian uint16 read of the first two bytes ("P","M") must equal this.
const PMTILES_MAGIC_LE = 0x4d50;

export class InvalidPMTilesFileError extends Error {}

/**
 * Read and parse the PMTiles v3 header of a local file.
 * Throws InvalidPMTilesFileError if the file is too small or has a bad magic.
 */
export async function readPMTilesHeader(filePath: string): Promise<Header> {
  const handle = await open(filePath, 'r');
  try {
    const readBuf = Buffer.alloc(HEADER_SIZE_BYTES);
    const { bytesRead } = await handle.read(readBuf, 0, HEADER_SIZE_BYTES, 0);
    if (bytesRead < HEADER_SIZE_BYTES) {
      throw new InvalidPMTilesFileError(
        `File is too small to contain a PMTiles header (${bytesRead} bytes read, need ${HEADER_SIZE_BYTES})`,
      );
    }

    const magic = readBuf.readUInt16LE(0);
    if (magic !== PMTILES_MAGIC_LE) {
      throw new InvalidPMTilesFileError('Invalid PMTiles magic number');
    }

    // readBuf is a freshly allocated Buffer of exactly HEADER_SIZE_BYTES, so
    // its underlying ArrayBuffer has no pooling offset to worry about.
    return bytesToHeader(readBuf.buffer.slice(readBuf.byteOffset, readBuf.byteOffset + readBuf.byteLength));
  } finally {
    await handle.close();
  }
}

export function tileTypeName(tileType: number): string {
  switch (tileType) {
    case TileType.Mvt:
      return 'mvt';
    case TileType.Png:
      return 'png';
    case TileType.Jpeg:
      return 'jpeg';
    case TileType.Webp:
      return 'webp';
    case TileType.Avif:
      return 'avif';
    case TileType.Mlt:
      return 'mlt';
    default:
      return 'unknown';
  }
}

export function compressionName(compression: number): string {
  switch (compression) {
    case Compression.None:
      return 'none';
    case Compression.Gzip:
      return 'gzip';
    case Compression.Brotli:
      return 'brotli';
    case Compression.Zstd:
      return 'zstd';
    default:
      return 'unknown';
  }
}
