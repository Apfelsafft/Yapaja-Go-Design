#!/usr/bin/env node
/**
 * bump-addon-version.mjs — "HA-Add-on-Repo-Version bump" aus
 * tasks/E10-qualitaet-release.md §E10-T5.
 *
 * ─── Was dieses Skript wirklich tut, und was es NICHT tut ───────────────────
 * Seit `feat/gui-install-path` IST dieses Monorepo selbst das
 * HA-Add-on-Repository: `repository.yaml` liegt im Wurzelverzeichnis und das
 * Add-on-Paket als `yapaja_go/` auf oberster Ebene -- genau das Layout, das
 * der Supervisor beim Eintragen einer Repository-URL erwartet
 * (docs/04-home-assistant.md §3). Ein separates `yapaja-go-ha-addon`-Repo
 * bleibt als spätere Spiegelung möglich, ist für den GUI-Weg aber nicht mehr
 * nötig; `yapaja_go/PACKAGING.md` hält das fest.
 *
 * Dieses Skript bumpt `yapaja_go/config.yaml`s `version:`-Feld -- die
 * maßgebliche Stelle, die der HA-Supervisor beim Update tatsächlich liest.
 * Ein etwaiger Push in ein separates Spiegel-Repository wäre ein
 * zusätzlicher Schritt, den `.github/workflows/release.yml` dokumentiert,
 * aber NICHT ausführt -- diese Entwicklungsumgebung hat weder Netzwerkzugriff
 * noch Schreibrechte auf ein zweites Repository, und ein Release-Workflow,
 * der einen Push vortäuscht, der nie stattfand, wäre schlimmer als einer,
 * der ihn ehrlich als offenen Schritt markiert.
 *
 * Verwendung:
 *   node scripts/bump-addon-version.mjs 1.2.0
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = resolve(__dirname, '..');
export const ADDON_CONFIG_PATH = join(REPO_ROOT, 'yapaja_go', 'config.yaml');

const VERSION_LINE_RE = /^version:\s*"[^"]*"\s*$/m;

/** `X.Y.Z` (optional `-prerelease`), keine führende "v" -- passend zum echten Tag-Format `vX.Y.Z`. */
export function normalizeVersion(rawArg) {
  const version = rawArg.startsWith('v') ? rawArg.slice(1) : rawArg;
  if (!/^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/.test(version)) {
    throw new Error(`Ungültige Version "${rawArg}" -- erwartet "X.Y.Z" oder "vX.Y.Z"`);
  }
  return version;
}

/** Ersetzt exakt die `version:`-Zeile, lässt den Rest von config.yaml unangetastet. */
export function bumpVersionLine(yamlText, newVersion) {
  if (!VERSION_LINE_RE.test(yamlText)) {
    throw new Error(`Konnte keine "version:"-Zeile in config.yaml finden -- Format geändert?`);
  }
  return yamlText.replace(VERSION_LINE_RE, `version: "${newVersion}"`);
}

function main() {
  const rawArg = process.argv[2];
  if (!rawArg) {
    console.error('Verwendung: node scripts/bump-addon-version.mjs <version>');
    process.exitCode = 1;
    return;
  }
  const newVersion = normalizeVersion(rawArg);
  const before = readFileSync(ADDON_CONFIG_PATH, 'utf-8');
  const after = bumpVersionLine(before, newVersion);
  if (before === after) {
    console.log(`yapaja_go/config.yaml ist bereits auf Version ${newVersion}.`);
    return;
  }
  writeFileSync(ADDON_CONFIG_PATH, after, 'utf-8');
  console.log(`yapaja_go/config.yaml: version -> "${newVersion}"`);
}

const isMain = process.argv[1] !== undefined && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url));
if (isMain) {
  main();
}
