#!/usr/bin/env node
/**
 * Baut `dist/evil-fixture.tgz` (E09-T6). NUR fuer manuelles Ausprobieren --
 * die Sicherheits-Suite baut denselben Tarball in-process
 * (`e2e/security/support/evilFixture.ts`), damit ein Lauf weder System-`tar`
 * noch einen vorgelagerten Build-Schritt braucht.
 *
 * Kein esbuild, keine Bundles: das Fixture ist absichtlich handgeschriebenes,
 * rohes JS ohne SDK (siehe README.md).
 */
import { mkdirSync, rmSync, cpSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DIST_DIR = join(__dirname, 'dist');
const STAGE_DIR = join(DIST_DIR, '_stage');

rmSync(STAGE_DIR, { recursive: true, force: true });
mkdirSync(STAGE_DIR, { recursive: true });
cpSync(join(__dirname, 'yapaja-addon.json'), join(STAGE_DIR, 'yapaja-addon.json'));
cpSync(join(__dirname, 'ui'), join(STAGE_DIR, 'ui'), { recursive: true });
cpSync(join(__dirname, 'service'), join(STAGE_DIR, 'service'), { recursive: true });

const tarballPath = join(DIST_DIR, 'evil-fixture.tgz');
if (existsSync(tarballPath)) rmSync(tarballPath);
// Explizite Top-Level-Namen statt `.` -- `extract.ts` weist einen `.`/leeren
// Eintragsnamen ab (siehe ../poi-campsites/build.mjs, gleiche Begruendung).
execFileSync('tar', ['czf', tarballPath, '-C', STAGE_DIR, 'yapaja-addon.json', 'ui', 'service'], {
  stdio: 'inherit',
});
console.log(`Built ${tarballPath} -- TEST-FIXTURE, niemals veroeffentlichen.`);
