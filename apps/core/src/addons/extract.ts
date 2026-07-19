/* eslint-disable no-undef -- `Buffer` is a standard Node global (typed via
 * @types/node); same justification as `auth/authGuard.ts`. */

/**
 * SECURITY-CRITICAL: streaming, hardened tarball extraction for the add-on
 * install pipeline (E09-T1, docs/05 §5). Untrusted tarballs (uploaded by an
 * operator OR fetched from a registry URL) are unpacked here -- this is the
 * classic path-traversal / zip-bomb / symlink-escape attack surface, so
 * EVERY entry gets its OWN validation, independent of whatever `tar-stream`
 * itself does (many tar libraries across the ecosystem have shipped
 * traversal CVEs; we never rely on a library's default extraction).
 *
 * Per-entry checks, applied BEFORE a single byte of that entry's content is
 * read:
 *  1. Entry type must be `file` or `directory`. Symlinks AND hardlinks are
 *     rejected OUTRIGHT (not just ones whose target escapes -- simplest and
 *     safest, see module-level rationale below). Block/char devices, FIFOs,
 *     and any other exotic type are rejected too.
 *  2. The entry name must not be empty/`.` and must not start with `/`
 *     (absolute path).
 *  3. `resolveEntryPath(destDir, entry.name)` (`./paths.ts`) resolves the
 *     entry against the destination directory and rejects anything that
 *     doesn't stay strictly inside it (`../` escapes of any depth).
 *
 * Any violation aborts the ENTIRE tarball (not just that entry) and cleans
 * up any partial extraction already written to `destDir`.
 *
 * Zip-bomb guard: a single cumulative counter of UNCOMPRESSED bytes across
 * ALL entries is checked after every chunk read off the (post-gunzip) tar
 * stream; the moment it exceeds `maxUncompressedBytes` extraction aborts --
 * this bounds real work/disk usage to ~`maxUncompressedBytes` regardless of
 * how large the compressed input claims to decompress to, and regardless of
 * what any entry's (attacker-controlled) header `size` field claims.
 *
 * Why reject ALL symlinks/hardlinks rather than only escaping ones: a
 * symlink whose target looks safe at extract time can still be swapped
 * (TOCTOU) or, more simply, a symlink planted INSIDE `data/addons/{id}`
 * pointing at a sensitive path elsewhere becomes a live escape hatch the
 * MOMENT any later code (this Core, or the add-on's own runtime) reads
 * through it -- add-ons have no legitimate need to ship symlinks, so the
 * simplest safe rule is the one we use.
 *
 * `destDir === null` runs in DRY-RUN mode: every check above still runs
 * (so a malicious tarball is rejected at the "install" -- validate-only --
 * step, before the two-step confirm gate), but no filesystem writes happen
 * and the uncompressed-byte counter still aborts a zip-bomb just as early.
 * This is what the two-step scope-confirm flow's first call
 * (`installService.ts#beginInstall`) uses; the second call (`confirmInstall`)
 * re-runs this with a real `destDir` (a throwaway staging directory) to
 * actually write files.
 */

import { Readable } from 'stream';
import { createWriteStream } from 'fs';
import { mkdir, rm } from 'fs/promises';
import { dirname as pathDirname } from 'path';
import { once } from 'events';
import { createGunzip } from 'zlib';
import * as tar from 'tar-stream';
import { TarballSecurityError } from './errors.js';
import { resolveEntryPath } from './paths.js';

/** Manifest file every add-on tarball must carry at its ROOT. */
export const MANIFEST_FILENAME = 'yapaja-addon.json';

/** Neutral, non-writable anchor used to run the traversal-resolve check in
 *  dry-run mode (`destDir === null`) -- never actually touched on disk;
 *  `resolveEntryPath` only ever does pure `path.resolve` arithmetic. */
const DRY_RUN_ANCHOR = '/__yapaja_addon_dry_run__';

export interface ExtractAddonTarballOptions {
  tarballBytes: Buffer;
  /** Absolute, already-validated destination directory to write into, or
   *  `null` for a validate-only dry run (no filesystem writes). */
  destDir: string | null;
  /** Cumulative UNCOMPRESSED byte cap across all entries (zip-bomb guard). */
  maxUncompressedBytes: number;
}

export interface ExtractAddonTarballResult {
  /** Raw (unparsed) contents of `yapaja-addon.json` at the tarball root. */
  manifestRaw: string;
  totalUncompressedBytes: number;
  fileCount: number;
  dirCount: number;
}

function isGzip(buf: Buffer): boolean {
  return buf.length >= 2 && buf[0] === 0x1f && buf[1] === 0x8b;
}

function bufferSourceStream(buf: Buffer): Readable {
  const stream = new Readable({ read() {} });
  stream.push(buf);
  stream.push(null);
  return stream;
}

/**
 * Extracts (or, in dry-run mode, merely validates) an add-on tarball. See
 * the module doc above for the full threat model / check list. Always
 * throws {@link TarballSecurityError} on any security violation or
 * malformed input -- never partially succeeds.
 */
export async function extractAddonTarball(
  opts: ExtractAddonTarballOptions,
): Promise<ExtractAddonTarballResult> {
  const { tarballBytes, destDir, maxUncompressedBytes } = opts;

  if (destDir) {
    await mkdir(destDir, { recursive: true });
  }

  const source = bufferSourceStream(tarballBytes);
  const gz = isGzip(tarballBytes) ? createGunzip() : null;
  const extract = tar.extract();

  if (gz) {
    source.on('error', (err) => extract.destroy(err));
    gz.on('error', (err) => extract.destroy(err));
    source.pipe(gz).pipe(extract);
  } else {
    source.on('error', (err) => extract.destroy(err));
    source.pipe(extract);
  }

  let manifestRaw: string | null = null;
  let totalUncompressedBytes = 0;
  let fileCount = 0;
  let dirCount = 0;

  async function fail(reason: string, message: string): Promise<never> {
    extract.destroy();
    gz?.destroy();
    source.destroy();
    if (destDir) {
      await rm(destDir, { recursive: true, force: true }).catch(() => {
        // Best-effort: the caller's own cleanup pass (if any) is the
        // backstop; a failed rm here must never mask the REAL error below.
      });
    }
    throw new TarballSecurityError(reason, message);
  }

  try {
    for await (const entry of extract) {
      const header = entry.header;
      const rawName = header.name ?? '';
      const name = rawName.startsWith('./') ? rawName.slice(2) : rawName;

      if (name === '' || name === '.') {
        return fail('EMPTY_NAME', 'Tarball entry has an empty or "." name');
      }
      if (name.startsWith('/')) {
        return fail('ABSOLUTE_PATH', `Tarball entry has an absolute path: "${rawName}"`);
      }

      const type = header.type;
      if (type === 'symlink' || type === 'link') {
        return fail(
          type === 'symlink' ? 'SYMLINK' : 'HARDLINK',
          `Tarball entry "${rawName}" is a ${type} -- symlinks/hardlinks are never allowed in add-on tarballs`,
        );
      }
      if (type !== 'file' && type !== 'directory') {
        return fail(
          'UNSUPPORTED_ENTRY_TYPE',
          `Tarball entry "${rawName}" has an unsupported type "${String(type)}" (only files and directories are allowed)`,
        );
      }

      const resolvedPath = resolveEntryPath(destDir ?? DRY_RUN_ANCHOR, name);
      if (!resolvedPath) {
        return fail(
          'PATH_TRAVERSAL',
          `Tarball entry escapes the destination directory: "${rawName}"`,
        );
      }

      if (type === 'directory') {
        dirCount++;
        if (destDir) {
          await mkdir(resolvedPath, { recursive: true });
        }
        // Directories carry no content, but drain defensively in case a
        // malformed/malicious header still attaches a body.
        for await (const chunk of entry as AsyncIterable<Buffer>) {
          totalUncompressedBytes += chunk.length;
          if (totalUncompressedBytes > maxUncompressedBytes) {
            return fail(
              'UNCOMPRESSED_SIZE_EXCEEDED',
              `Tarball exceeds the ${maxUncompressedBytes}-byte uncompressed cap`,
            );
          }
        }
        continue;
      }

      // type === 'file'
      fileCount++;
      const isManifest = name === MANIFEST_FILENAME;
      const manifestChunks: Buffer[] = [];

      let writeStream: ReturnType<typeof createWriteStream> | null = null;
      if (destDir) {
        await mkdir(pathDirname(resolvedPath), { recursive: true });
        writeStream = createWriteStream(resolvedPath);
        // A forced `.destroy()` below (zip-bomb abort) can race with an
        // in-flight write's fs completion callback, which then tries to
        // continue against the now-destroyed stream -- that surfaces as an
        // ERR_STREAM_DESTROYED 'error' event. We already produce our own
        // TarballSecurityError for this case, so swallow it here rather
        // than letting it become an unhandled rejection/exception.
        writeStream.on('error', () => {});
      }

      for await (const chunk of entry as AsyncIterable<Buffer>) {
        totalUncompressedBytes += chunk.length;
        if (totalUncompressedBytes > maxUncompressedBytes) {
          writeStream?.destroy();
          return fail(
            'UNCOMPRESSED_SIZE_EXCEEDED',
            `Tarball exceeds the ${maxUncompressedBytes}-byte uncompressed cap`,
          );
        }
        if (isManifest) manifestChunks.push(chunk);
        if (writeStream && !writeStream.write(chunk)) {
          await once(writeStream, 'drain');
        }
      }

      if (writeStream) {
        writeStream.end();
        await once(writeStream, 'finish');
      }
      if (isManifest) {
        manifestRaw = Buffer.concat(manifestChunks).toString('utf-8');
      }
    }
  } catch (err) {
    if (err instanceof TarballSecurityError) throw err;
    return fail(
      'MALFORMED_TARBALL',
      `Failed to parse tarball: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  if (manifestRaw === null) {
    return fail(
      'MANIFEST_NOT_FOUND',
      `No ${MANIFEST_FILENAME} found at the tarball root`,
    );
  }

  return { manifestRaw, totalUncompressedBytes, fileCount, dirCount };
}
