/**
 * CLI entry point for `build-lite-index.sh` (E05-T5, W-12). Thin glue only
 * -- all actual logic lives in the unit-tested `extract.ts`/`buildIndex.ts`
 * modules; this file just wires stdio/argv to them and owns the ONE
 * filesystem side effect that needs to be atomic: writing to a temp path
 * and renaming it into place (same "temp file + rename" discipline as
 * `services/valhalla/build-tiles.sh`'s directory swap, W-17 -- a `rename(2)`
 * on the same filesystem is atomic, so a reader (the running Core process)
 * either sees the old complete file or the new complete file, never a
 * half-written one).
 *
 * Usage:
 *   tsx src/search/lite/cli.ts --places places.geojsonseq --streets streets.geojsonseq --out data/lite-search/lite_search.db
 *
 * Run via `services/valhalla/build-lite-index.sh`, never invoked directly
 * by the app itself.
 */
import { createReadStream, existsSync, renameSync, unlinkSync } from 'fs';
import { createInterface } from 'readline';
import { normalizeGeoJsonSeqLine, type NormalizedRecord } from './extract.js';
import { buildLiteIndexFile } from './buildIndex.js';

interface CliArgs {
  places?: string;
  streets?: string;
  out: string;
}

function parseArgs(argv: string[]): CliArgs {
  const args: Partial<CliArgs> = {};
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--places') args.places = argv[++i];
    else if (arg === '--streets') args.streets = argv[++i];
    else if (arg === '--out') args.out = argv[++i];
  }
  if (!args.out) {
    throw new Error('Usage: cli.ts --places <geojsonseq> --streets <geojsonseq> --out <lite_search.db path>');
  }
  return args as CliArgs;
}

async function readNormalizedFile(
  path: string,
  sourceKind: 'place' | 'street',
): Promise<{ records: NormalizedRecord[]; skipped: number; total: number }> {
  const records: NormalizedRecord[] = [];
  let skipped = 0;
  let total = 0;

  const rl = createInterface({ input: createReadStream(path, { encoding: 'utf8' }), crlfDelay: Infinity });
  for await (const line of rl) {
    if (line.trim().length === 0) continue;
    total += 1;
    const record = normalizeGeoJsonSeqLine(line, sourceKind);
    if (record) records.push(record);
    else skipped += 1;
  }

  return { records, skipped, total };
}

export async function runCli(argv: string[]): Promise<void> {
  const args = parseArgs(argv);
  const allRecords: NormalizedRecord[] = [];

  if (args.places) {
    const { records, skipped, total } = await readNormalizedFile(args.places, 'place');
    console.warn(`Orte: ${records.length}/${total} uebernommen (${skipped} uebersprungen) aus ${args.places}`);
    allRecords.push(...records);
  }

  if (args.streets) {
    const { records, skipped, total } = await readNormalizedFile(args.streets, 'street');
    console.warn(`Strassen: ${records.length}/${total} uebernommen (${skipped} uebersprungen) aus ${args.streets}`);
    allRecords.push(...records);
  }

  if (allRecords.length === 0) {
    throw new Error('Keine Datensaetze extrahiert -- Build abgebrochen (leerer Index waere nutzlos).');
  }

  const tmpPath = `${args.out}.tmp-${process.pid}`;
  if (existsSync(tmpPath)) unlinkSync(tmpPath);

  try {
    buildLiteIndexFile(allRecords, tmpPath);
    // Atomic swap (W-17 discipline): rename(2) on the same filesystem is
    // atomic -- a concurrent reader of `args.out` (the running Core
    // process) sees either the complete old file or the complete new file,
    // never a partial write.
    renameSync(tmpPath, args.out);
  } catch (err) {
    if (existsSync(tmpPath)) unlinkSync(tmpPath);
    throw err;
  }

  console.warn(`Lite-Suchindex gebaut: ${args.out} (${allRecords.length} Datensaetze insgesamt)`);
}

// Only run when this module is the actual CLI entry point, not when
// imported by a test.
if (process.argv[1]?.endsWith('cli.ts') || process.argv[1]?.endsWith('cli.js')) {
  runCli(process.argv.slice(2)).catch((err) => {
    console.error('build-lite-index CLI fehlgeschlagen:', err instanceof Error ? err.message : err);
    process.exitCode = 1;
  });
}
