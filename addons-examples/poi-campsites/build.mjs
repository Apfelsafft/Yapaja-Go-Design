#!/usr/bin/env node
/**
 * Build script for the "Stellplätze-Overlay" reference add-on (E09-T5,
 * docs/addon-dev-guide.md §1.4). Produces:
 *
 *   1. `ui/bundle.js` -- `src/main.ts` (which imports `@yapaja/addon-sdk`)
 *      bundled by esbuild into ONE self-contained ES module with NO bare
 *      import specifiers left (a sandboxed add-on iframe has no
 *      node_modules/import-map resolution, only same-origin `<script>`
 *      loads -- see `apps/core/src/addons/ui-host.ts`'s CSP). esbuild
 *      resolves `@yapaja/addon-sdk`/`@yapaja/shared` straight from their
 *      TypeScript SOURCE via `alias` (this package is deliberately not a
 *      pnpm workspace member -- see ../README.md -- so there is no
 *      node_modules-linked build of either to depend on).
 *   2. `dist/poi-campsites.tgz` -- the installable tarball: `yapaja-addon.json`
 *      at the TOP LEVEL (required, see `apps/core/src/addons/extract.ts`)
 *      plus the `ui/` directory (index.html + the bundle).
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

function bundleUi() {
  esbuild.buildSync({
    entryPoints: [join(__dirname, 'src', 'main.ts')],
    outfile: join(__dirname, 'ui', 'bundle.js'),
    bundle: true,
    // IIFE, not 'esm': the add-on iframe is `sandbox="allow-scripts"` WITHOUT
    // `allow-same-origin`, so it runs with an OPAQUE origin ("null"). A
    // `<script type="module">` load is ALWAYS subject to CORS regardless of
    // same-path/same-server-ness (unlike a classic script), and an opaque
    // origin can never satisfy a same-origin CORS check -- so a module bundle
    // fails to load with "Access to script ... blocked by CORS policy"
    // (discovered while building this reference add-on's e2e test). IIFE
    // output is a plain classic script (no import/export left, everything is
    // already bundled inline), loadable via a plain `<script src=...>` with
    // no `type="module"` and therefore no CORS check at all.
    format: 'iife',
    platform: 'browser',
    target: 'es2020',
    sourcemap: false,
    minify: false,
    loader: { '.geojson': 'json' },
    alias: {
      '@yapaja/addon-sdk': join(REPO_ROOT, 'packages', 'addon-sdk', 'src', 'index.ts'),
      '@yapaja/shared': join(REPO_ROOT, 'packages', 'shared', 'src', 'index.ts'),
    },
    logLevel: 'info',
  });
}

function stageAndPack() {
  rmSync(STAGE_DIR, { recursive: true, force: true });
  mkdirSync(STAGE_DIR, { recursive: true });
  cpSync(join(__dirname, 'yapaja-addon.json'), join(STAGE_DIR, 'yapaja-addon.json'));
  cpSync(join(__dirname, 'ui'), join(STAGE_DIR, 'ui'), { recursive: true });

  const tarballPath = join(DIST_DIR, 'poi-campsites.tgz');
  if (existsSync(tarballPath)) rmSync(tarballPath);
  // Entries are written with paths RELATIVE to STAGE_DIR, naming each
  // top-level member EXPLICITLY (`yapaja-addon.json`, `ui`) rather than `.`
  // -- GNU tar's `-C dir .` form emits a leading `./` directory entry, which
  // the install pipeline's tarball-safety check rejects outright (empty/"."
  // entry name, `apps/core/src/addons/extract.ts`). Explicit names also
  // means `yapaja-addon.json` lands at the tarball's top level, as required.
  execFileSync('tar', ['czf', tarballPath, '-C', STAGE_DIR, 'yapaja-addon.json', 'ui'], { stdio: 'inherit' });
  console.log(`Built ${tarballPath}`);
}

bundleUi();
stageAndPack();
