/**
 * CLI half of the offline restriction-provenance pipeline (E10-T3).
 *
 * Invoked by `scripts/osm-restriction-provenance.sh`, never directly by the
 * app. All judgement lives in the unit-tested, pure `provenance.ts`; this file
 * only wires argv/stdio/filesystem to it — the same thin-glue split
 * `apps/core/src/search/lite/cli.ts` uses for the Lite-Index builder.
 *
 * Usage (see the shell wrapper for the osmium half):
 *   tsx provenanceCli.ts verify   --candidates ways.geojsonseq [--region de] \
 *                                 [--source-label "germany-latest.osm.pbf 2026-08-04"] \
 *                                 [--out report.json] [--fail-on-unconfirmed]
 *   tsx provenanceCli.ts discover --candidates ways.geojsonseq --kind maxwidth [--limit 25]
 *
 * Exit codes:
 *   0  the run produced a report (whatever the verdicts say)
 *   1  usage / IO error, or the extraction yielded no usable candidates at all
 *      (that is a broken tool chain, not a fixture finding)
 *   2  only with --fail-on-unconfirmed: at least one case is not `confirmed`
 */

import { createReadStream, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createInterface } from 'node:readline';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  discover,
  parseGeoJsonSeqLine,
  reportForCase,
  restrictionCases,
  type CaseProvenanceReport,
  type OsmWayCandidate,
} from './provenance.js';
import type { GoldenRoutesFile, RestrictionCase } from './types.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

type Kind = RestrictionCase['restriction']['kind'];
const KINDS: readonly Kind[] = ['maxheight', 'maxweight', 'maxwidth'];

interface Args {
  mode: 'verify' | 'discover';
  candidates: string;
  region: string;
  kind: Kind;
  limit: number;
  sourceLabel: string;
  out: string | null;
  failOnUnconfirmed: boolean;
}

function out(text: string): void {
  process.stdout.write(`${text}\n`);
}

function parseArgs(argv: readonly string[]): Args {
  const mode = argv[0];
  if (mode !== 'verify' && mode !== 'discover') {
    throw new Error(`First argument must be 'verify' or 'discover' (got ${mode ?? '<none>'})`);
  }
  const args: Args = {
    mode,
    candidates: '',
    region: 'de',
    kind: 'maxheight',
    limit: 25,
    sourceLabel: 'OSM PBF',
    out: null,
    failOnUnconfirmed: false,
  };
  for (let i = 1; i < argv.length; i += 1) {
    const flag = argv[i];
    const next = (): string => {
      const v = argv[i + 1];
      if (v === undefined) throw new Error(`${flag} needs a value`);
      i += 1;
      return v;
    };
    switch (flag) {
      case '--candidates':
        args.candidates = next();
        break;
      case '--region':
        args.region = next();
        break;
      case '--kind': {
        const k = next();
        if (!KINDS.includes(k as Kind)) throw new Error(`--kind must be one of ${KINDS.join('|')}`);
        args.kind = k as Kind;
        break;
      }
      case '--limit':
        args.limit = Number(next());
        break;
      case '--source-label':
        args.sourceLabel = next();
        break;
      case '--out':
        args.out = next();
        break;
      case '--fail-on-unconfirmed':
        args.failOnUnconfirmed = true;
        break;
      default:
        throw new Error(`Unknown argument: ${flag}`);
    }
  }
  if (!args.candidates) throw new Error('--candidates <geojsonseq file> is required');
  if (!Number.isInteger(args.limit) || args.limit <= 0) throw new Error('--limit must be a positive integer');
  return args;
}

/** Streams the GeoJSONSeq file so a country-sized extract never lands in RAM at once. */
async function readCandidates(path: string): Promise<{ candidates: OsmWayCandidate[]; skipped: number }> {
  const candidates: OsmWayCandidate[] = [];
  let skipped = 0;
  const rl = createInterface({
    input: createReadStream(path, { encoding: 'utf8' }),
    crlfDelay: Infinity,
  });
  for await (const line of rl) {
    if (line.trim().length === 0) continue;
    const parsed = parseGeoJsonSeqLine(line);
    if (parsed) candidates.push(parsed);
    else skipped += 1;
  }
  return { candidates, skipped };
}

function loadCases(): GoldenRoutesFile {
  return JSON.parse(
    readFileSync(resolve(__dirname, '..', 'golden-routes.json'), 'utf-8'),
  ) as GoldenRoutesFile;
}

function printVerify(reports: readonly CaseProvenanceReport[], sourceLabel: string): void {
  out('');
  out('================================================================');
  out(` RESTRICTION PROVENANCE — verify (source: ${sourceLabel})`);
  out('================================================================');
  for (const r of reports) {
    out('');
    out(`--- ${r.caseId}  [${r.kind}, fixture claims ${r.declaredValue}] -> ${r.verdict.toUpperCase()}`);
    out(`    ${r.note}`);
    if (r.matches.length > 0) {
      out(`    candidates in box (${r.matches.length}, most binding first):`);
      for (const m of r.matches.slice(0, 10)) {
        out(
          `      way ${m.candidate.osm_way_id}  ${m.tagKey}=${m.parsed.raw}` +
            ` -> ${m.parsed.value} ${m.parsed.unit}` +
            (m.candidate.tags.name ? `  "${m.candidate.tags.name}"` : '') +
            (m.candidate.tags.highway ? `  highway=${m.candidate.tags.highway}` : ''),
        );
      }
      if (r.matches.length > 10) out(`      ... and ${r.matches.length - 10} more`);
    }
    if (r.suggestedBlock) {
      out('    paste into golden-routes.json (AFTER the routing assertions of this case go green):');
      for (const line of JSON.stringify({ restriction: r.suggestedBlock }, null, 2).split('\n')) {
        out(`      ${line}`);
      }
    } else {
      out('    NO block emitted — there is nothing real to freeze. Do NOT hand-fill an osm_way_id.');
    }
  }

  const tally = new Map<string, number>();
  for (const r of reports) tally.set(r.verdict, (tally.get(r.verdict) ?? 0) + 1);
  out('');
  out('---------------- SUMMARY ----------------');
  for (const [verdict, count] of [...tally].sort()) out(`  ${verdict}: ${count}`);
  out(
    '  A case may only lose `unverified: true` when it is CONFIRMED here AND its routing\n' +
      '  assertions (small enters the box, large does not) went green in the same run.',
  );
}

async function main(): Promise<number> {
  const args = parseArgs(process.argv.slice(2));
  const { candidates, skipped } = await readCandidates(args.candidates);
  out(`Read ${candidates.length} usable way candidate(s) from ${args.candidates} (${skipped} line(s) skipped).`);

  if (candidates.length === 0) {
    process.stderr.write(
      'ERROR: zero usable candidates. That is a tool-chain failure (bad osmium filter/export or an\n' +
        '       empty extract), not a finding about the fixture — refusing to emit a report.\n',
    );
    return 1;
  }

  if (args.mode === 'discover') {
    const found = discover(candidates, args.kind, { limit: args.limit });
    out('');
    out(`=== DISCOVER ${args.kind} — ${found.length} real, currently-tagged way(s), most binding first ===`);
    out('Use these to REPLACE a curated case that verify could not confirm. Each line is evidence');
    out('from the routed dataset; pick one whose road a motorhome would plausibly be sent down.');
    for (const d of found) {
      out(
        `  way ${d.osm_way_id}  ${d.tagKey}=${d.raw} -> ${d.value} ${d.unit}` +
          `  bbox=[${d.bbox.map((n) => n.toFixed(5)).join(', ')}]` +
          (d.name ? `  "${d.name}"` : ''),
      );
    }
    if (args.out) writeReport(args.out, { mode: 'discover', kind: args.kind, found });
    return 0;
  }

  const cases = restrictionCases(loadCases().cases, args.region);
  if (cases.length === 0) {
    process.stderr.write(`ERROR: no restriction cases for region '${args.region}'.\n`);
    return 1;
  }
  const reports = cases.map((c) => reportForCase(c, candidates, { sourceLabel: args.sourceLabel }));
  printVerify(reports, args.sourceLabel);
  if (args.out) {
    writeReport(args.out, {
      mode: 'verify',
      region: args.region,
      source: args.sourceLabel,
      generated_at: new Date().toISOString(),
      reports,
    });
  }

  if (args.failOnUnconfirmed && reports.some((r) => r.verdict !== 'confirmed')) {
    process.stderr.write('At least one restriction case is not CONFIRMED (--fail-on-unconfirmed).\n');
    return 2;
  }
  return 0;
}

function writeReport(path: string, payload: unknown): void {
  mkdirSync(dirname(resolve(path)), { recursive: true });
  writeFileSync(path, `${JSON.stringify(payload, null, 2)}\n`, 'utf-8');
  out(`\nMachine-readable report written to ${path}`);
}

main()
  .then((code) => {
    process.exitCode = code;
  })
  .catch((err: unknown) => {
    process.stderr.write(`${err instanceof Error ? err.message : String(err)}\n`);
    process.exitCode = 1;
  });
