#!/usr/bin/env node
/**
 * changeset-breaking-check.mjs — erzwingt, dass ein Changeset mit einem
 * `major`-Bump der Add-on-API-Pakete (E10-T5 Plausibilität: "Changelog
 * erwähnt Breaking Changes der Add-on-API explizit (Changesets-Kategorie
 * erzwungen)") einen eigenen "## Breaking Change"-Abschnitt im Changeset-Text
 * hat. Changesets selbst kennt KEINE eingebaute "Breaking"-Kategorie -- es
 * kennt nur major/minor/patch je Paket. Ein Bump allein ("major") sagt einem
 * Add-on-Autor nicht, WAS gebrochen ist; dieses Skript macht "major auf
 * @yapaja/core oder @yapaja/addon-sdk" und "Breaking-Change-Abschnitt
 * vorhanden" zu einer MASCHINELL geprüften Paarung, nicht zu einer bloßen
 * Konvention -- genau das ist mit "erzwungen" statt "dokumentiert" gemeint.
 *
 * Warum genau diese zwei Pakete: `@yapaja/core`s package.json-Version ist
 * die `core_api`-Semver-Range, gegen die JEDES installierte Add-on beim
 * Core-Start geprüft wird (Wargame W-11, `apps/core/src/addons/
 * installService.ts`); `@yapaja/addon-sdk` ist das Paket, das Add-on-Autoren
 * tatsächlich importieren (`docs/addon-dev-guide.md`). Ein major-Bump von
 * irgendeinem anderen Workspace-Paket (`@yapaja/shared`, `@yapaja/ui`,
 * `@yapaja/web`) berührt die Add-on-API nicht und braucht diesen Abschnitt
 * nicht.
 *
 * Da der generierte CHANGELOG.md (`@changesets/cli`s Default-Changelog-
 * Generator) den vollen Changeset-Text pro Eintrag übernimmt, taucht der
 * "## Breaking Change"-Abschnitt danach WÖRTLICH im veröffentlichten
 * Changelog auf -- keine zweite, separat zu pflegende Stelle.
 *
 * Verwendung:
 *   node scripts/changeset-breaking-check.mjs          # Bericht
 *   node scripts/changeset-breaking-check.mjs --check   # zusätzlich Exit 1 bei Verstoß
 */

import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = resolve(__dirname, '..');
export const CHANGESET_DIR = join(REPO_ROOT, '.changeset');

/** Pakete, deren major-Bump die Add-on-API betrifft (siehe Doku-Kommentar oben). */
export const ADDON_API_PACKAGES = ['@yapaja/core', '@yapaja/addon-sdk'];

/** Muss als eigene Markdown-Überschrift im Changeset-Text stehen. */
export const BREAKING_HEADING_RE = /^##\s*Breaking Change\b/im;

/**
 * Parst ein Changesets-Markdown-File: YAML-artiges Frontmatter
 * (`"pkg": major`-Zeilen) + Freitext-Body. Gibt `null` zurück, wenn die
 * Datei kein gültiges Changeset-Frontmatter hat (z. B. README.md).
 */
export function parseChangesetFile(raw) {
  const match = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/);
  if (!match) return null;
  const [, frontmatter, body] = match;
  const bumps = {};
  for (const line of frontmatter.split(/\r?\n/)) {
    const bumpMatch = line.match(/^"([^"]+)":\s*(major|minor|patch)\s*$/);
    if (bumpMatch) bumps[bumpMatch[1]] = bumpMatch[2];
  }
  return { bumps, body: body.trim() };
}

/** True, wenn dieser Bump-Satz einen erzwungenen Breaking-Change-Abschnitt braucht. */
export function requiresBreakingSection(bumps) {
  return ADDON_API_PACKAGES.some((pkg) => bumps[pkg] === 'major');
}

/** True, wenn der Changeset-Text den Pflicht-Abschnitt enthält. */
export function hasBreakingSection(body) {
  return BREAKING_HEADING_RE.test(body);
}

/**
 * Prüft eine einzelne Changeset-Datei. Rückgabe `{ ok, reason }`;
 * `reason` ist nur bei `ok: false` gesetzt.
 */
export function checkChangesetContent(raw) {
  const parsed = parseChangesetFile(raw);
  if (!parsed) return { ok: true, skipped: true };
  if (!requiresBreakingSection(parsed.bumps)) return { ok: true, skipped: false };
  const ok = hasBreakingSection(parsed.body);
  return ok
    ? { ok: true, skipped: false }
    : { ok: false, skipped: false, reason: 'major-Bump auf Add-on-API-Paket ohne "## Breaking Change"-Abschnitt' };
}

function listChangesetFiles(dir) {
  let entries;
  try {
    entries = readdirSync(dir);
  } catch {
    return [];
  }
  return entries.filter((name) => name.endsWith('.md') && name.toLowerCase() !== 'readme.md').map((name) => join(dir, name));
}

function main() {
  const check = process.argv.includes('--check');
  const files = listChangesetFiles(CHANGESET_DIR);

  if (files.length === 0) {
    console.log('Keine offenen Changesets (.changeset/*.md) -- nichts zu prüfen.');
    return;
  }

  const violations = [];
  for (const file of files) {
    const raw = readFileSync(file, 'utf-8');
    const result = checkChangesetContent(raw);
    const relative = file.slice(REPO_ROOT.length + 1);
    if (result.skipped) {
      console.log(`- ${relative}: kein gültiges Changeset-Frontmatter, übersprungen`);
      continue;
    }
    if (result.ok) {
      console.log(`- ${relative}: OK`);
    } else {
      console.log(`- ${relative}: FEHLT — ${result.reason}`);
      violations.push({ file: relative, reason: result.reason });
    }
  }

  if (check && violations.length > 0) {
    console.error(
      `\nFEHLER: ${violations.length} Changeset(s) bumpen @yapaja/core und/oder @yapaja/addon-sdk auf ` +
        'major, ohne einen "## Breaking Change"-Abschnitt zu benennen (Plausibilitätskriterium ' +
        'E10-T5: "Changelog erwähnt Breaking Changes der Add-on-API explizit").',
    );
    process.exitCode = 1;
  }
}

const isMain = process.argv[1] !== undefined && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url));
if (isMain) {
  main();
}
