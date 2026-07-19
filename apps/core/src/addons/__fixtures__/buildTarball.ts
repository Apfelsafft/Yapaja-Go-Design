/* eslint-disable no-undef -- `Buffer` is a standard Node global (typed via
 * @types/node); same justification as `auth/authGuard.ts`. */

/**
 * Test-only tarball builder (E09-T1): constructs `.tar`/`.tar.gz` buffers
 * in-process for both valid add-on fixtures AND the malicious tarballs the
 * security unit tests throw at `extract.ts`/the install pipeline (path
 * traversal, absolute paths, symlinks, hardlinks, zip bombs). Deliberately
 * lives under `__fixtures__` (like `map/__fixtures__/pmtiles-fixture.ts`) so
 * it's shared by every `*.test.ts` in this directory without being a test
 * file itself.
 *
 * Uses `tar-stream`'s `pack()` directly -- the SAME library the production
 * `extract.ts` reads with `tar.extract()` -- rather than shelling out to the
 * system `tar` binary, so these fixtures build identically in any CI
 * environment and can construct headers the real `tar` CLI wouldn't let you
 * create on purpose (e.g. a `..`-traversal entry name).
 */

import * as tar from 'tar-stream';
import { createGzip } from 'zlib';
import type { Readable } from 'stream';
import type { AddonManifest } from '@yapaja/shared';

export interface TarEntrySpec {
  name: string;
  /** Full tar-stream type union (not just file/directory/symlink/link) so
   *  tests can also build fifo/device entries to prove those are rejected. */
  type?: NonNullable<tar.Headers['type']>;
  content?: Buffer | string;
  /** Target for symlink/hardlink entries. */
  linkname?: string;
}

function collectChunks(stream: Readable): Promise<Buffer> {
  return new Promise((resolveChunks, rejectChunks) => {
    const chunks: Buffer[] = [];
    stream.on('data', (chunk: Buffer) => chunks.push(chunk));
    stream.on('end', () => resolveChunks(Buffer.concat(chunks)));
    stream.on('error', rejectChunks);
  });
}

/** Builds a tarball (optionally gzip-compressed) from `entries`, in the
 *  exact order given.
 *
 *  IMPORTANT: the output pipeline is wired up and starts draining BEFORE
 *  any entry is written -- `tar.pack()`'s Readable side has a bounded
 *  internal buffer, so writing a large entry (e.g. the zip-bomb fixture's
 *  many-MB body) while nothing is consuming the pack's output yet would
 *  deadlock (the write's callback never fires because there's no
 *  backpressure relief). Attaching the consumer FIRST means writes always
 *  drain concurrently, regardless of entry size. */
export async function buildTarball(
  entries: readonly TarEntrySpec[],
  opts: { gzip?: boolean } = {},
): Promise<Buffer> {
  const pack = tar.pack();
  const output: Readable = opts.gzip ? pack.pipe(createGzip()) : pack;
  const resultPromise = collectChunks(output);

  for (const entry of entries) {
    const content =
      entry.content === undefined
        ? undefined
        : Buffer.isBuffer(entry.content)
          ? entry.content
          : Buffer.from(entry.content, 'utf-8');

    await new Promise<void>((resolvePack, rejectPack) => {
      const header: tar.Headers = {
        name: entry.name,
        type: entry.type ?? 'file',
        ...(entry.linkname !== undefined ? { linkname: entry.linkname } : {}),
      };
      const done = (err?: Error | null): void => (err ? rejectPack(err) : resolvePack());
      if (content !== undefined) {
        pack.entry(header, content, done);
      } else {
        pack.entry(header, done);
      }
    });
  }

  pack.finalize();

  return resultPromise;
}

/** A minimal, fully valid manifest -- override individual fields per test. */
export function validManifest(overrides: Partial<AddonManifest> = {}): AddonManifest {
  return {
    id: 'com.example.test-addon',
    name: 'Test Add-on',
    version: '1.0.0',
    core_api: '*',
    author: 'Test Author',
    license: 'MIT',
    description: 'A minimal add-on fixture for tests',
    permissions: ['pos.read'],
    ...overrides,
  };
}

/** Builds a well-formed, installable add-on tarball: `yapaja-addon.json` at
 *  the root plus whatever extra entries the caller wants (e.g. the files a
 *  manifest's `service.entry`/`ui.entry` declare). */
export async function buildValidAddonTarball(opts: {
  manifest?: Partial<AddonManifest>;
  extraEntries?: readonly TarEntrySpec[];
  gzip?: boolean;
} = {}): Promise<{ bytes: Buffer; manifest: AddonManifest }> {
  const manifest = validManifest(opts.manifest);
  const entries: TarEntrySpec[] = [
    { name: 'yapaja-addon.json', content: JSON.stringify(manifest, null, 2) },
    ...(opts.extraEntries ?? []),
  ];
  const bytes = await buildTarball(entries, { gzip: opts.gzip ?? true });
  return { bytes, manifest };
}

/** A `.tar.gz` "zip bomb": a single entry of highly-compressible zero bytes
 *  whose UNCOMPRESSED size exceeds `uncompressedBytes`, but whose gzip
 *  representation is tiny (well under any reasonable compressed-size cap).
 *  Used to prove the streaming per-entry uncompressed-byte counter aborts
 *  extraction instead of ever writing `uncompressedBytes` worth of data to
 *  disk. */
export async function buildZipBombTarball(uncompressedBytes: number): Promise<Buffer> {
  const manifest = validManifest();
  return buildTarball(
    [
      { name: 'yapaja-addon.json', content: JSON.stringify(manifest) },
      { name: 'bomb.bin', content: Buffer.alloc(uncompressedBytes, 0) },
    ],
    { gzip: true },
  );
}
