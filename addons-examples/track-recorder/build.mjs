#!/usr/bin/env node
/**
 * Build script for the Track-Recorder reference add-on (E09-T5,
 * docs/addon-dev-guide.md §2.4). Produces two esbuild bundles (both
 * self-contained -- no bare `@yapaja/*` import specifiers left, resolved
 * straight from source via `alias`, same reasoning as
 * `../poi-campsites/build.mjs`) plus the installable tarball:
 *
 *   1. `ui/bundle.js`        -- browser bundle of `src/ui.ts`.
 *   2. `dist/_stage/service/main.mjs` -- NODE bundle of `src/service.ts`.
 *      `.mjs` (not `.js`) so the Core's spawned child process
 *      (`node <entry>`, `apps/core/src/addons/service-host.ts`) always runs
 *      it as an ES module regardless of any nearby `package.json`'s `type`
 *      field -- the installed add-on package ships no `package.json` at all.
 *   3. `dist/track-recorder.tgz` -- `yapaja-addon.json` at the top level
 *      (required) + `ui/` + `service/`.
 */
import * as esbuild from 'esbuild';
import { mkdirSync, rmSync, cpSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, '..', '..');
const DIST_DIR = join(__dirname, 'dist');
const STAGE_DIR = join(DIST_DIR, '_stage');

const ALIAS = {
  '@yapaja/addon-sdk': join(REPO_ROOT, 'packages', 'addon-sdk', 'src', 'index.ts'),
  '@yapaja/shared': join(REPO_ROOT, 'packages', 'shared', 'src', 'index.ts'),
};

function bundleUi() {
  esbuild.buildSync({
    entryPoints: [join(__dirname, 'src', 'ui.ts')],
    outfile: join(__dirname, 'ui', 'bundle.js'),
    bundle: true,
    // IIFE, not 'esm' -- see ../poi-campsites/build.mjs's identical comment:
    // a `<script type="module">` load inside the opaque-origin sandboxed
    // add-on iframe always fails CORS. The SERVICE bundle below stays 'esm'
    // (`.mjs`, run by plain Node -- no browser module-CORS rule applies there).
    format: 'iife',
    platform: 'browser',
    target: 'es2020',
    sourcemap: false,
    alias: ALIAS,
    logLevel: 'info',
  });
}

function bundleService(stageDir) {
  const outfile = join(stageDir, 'service', 'main.mjs');
  mkdirSync(dirname(outfile), { recursive: true });
  esbuild.buildSync({
    entryPoints: [join(__dirname, 'src', 'service.ts')],
    outfile,
    bundle: true,
    format: 'esm',
    platform: 'node',
    target: 'node20',
    sourcemap: false,
    alias: ALIAS,
    logLevel: 'info',
  });
}

function stageAndPack() {
  rmSync(STAGE_DIR, { recursive: true, force: true });
  mkdirSync(STAGE_DIR, { recursive: true });
  cpSync(join(__dirname, 'yapaja-addon.json'), join(STAGE_DIR, 'yapaja-addon.json'));
  cpSync(join(__dirname, 'ui'), join(STAGE_DIR, 'ui'), { recursive: true });
  bundleService(STAGE_DIR);

  const tarballPath = join(DIST_DIR, 'track-recorder.tgz');
  if (existsSync(tarballPath)) rmSync(tarballPath);
  // Explicit top-level entry names, not `.` -- see poi-campsites/build.mjs's
  // identical comment for why (`extract.ts` rejects a `.`/empty entry name).
  execFileSync('tar', ['czf', tarballPath, '-C', STAGE_DIR, 'yapaja-addon.json', 'ui', 'service'], {
    stdio: 'inherit',
  });
  console.log(`Built ${tarballPath}`);
}

bundleUi();
stageAndPack();
