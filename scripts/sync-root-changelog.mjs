#!/usr/bin/env node
/**
 * sync-root-changelog.mjs — Teil des "GitHub-Release mit Changelog
 * (Changesets)"-Schritts aus tasks/E10-qualitaet-release.md §E10-T5.
 *
 * Changesets schreibt (mit der `"fixed"`-Gruppierung aus
 * `.changeset/config.json`) einen Eintrag in JEDES gruppierte Pakets
 * eigenes `CHANGELOG.md`. Für die menschenlesbare Release-Übersicht an
 * EINER Stelle (`CHANGELOG.md` im Repo-Root, per Aufgabenstellung
 * ausdrücklich als Pfad genannt) übernimmt dieses Skript den jeweils
 * neuesten Abschnitt aus `apps/core/CHANGELOG.md` — `@yapaja/core` ist die
 * Add-on-API-tragende Paketversion (Wargame W-11), also der Kandidat mit
 * der größten Signalwirkung, falls mehrere gruppierte Pakete gleichzeitig
 * einen Eintrag bekämen.
 *
 * Läuft NACH `pnpm changeset:version` (das die Changesets tatsächlich
 * konsumiert und `apps/core/CHANGELOG.md` schreibt/erweitert) und VOR dem
 * Erstellen der GitHub-Release-Notes (`.github/workflows/release.yml`
 * nutzt danach `extractSection(rootChangelog, version)`, um genau den neu
 * eingefügten Abschnitt als Release-Body zu verwenden).
 *
 * Idempotent: ein bereits vorhandener Abschnitt für dieselbe Version wird
 * nicht doppelt eingefügt (wichtig, falls der Release-Workflow neu gestartet
 * wird, ohne dass sich an den Changesets etwas geändert hat).
 *
 * Verwendung:
 *   node scripts/sync-root-changelog.mjs
 */

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = resolve(__dirname, '..');
export const PACKAGE_CHANGELOG_PATH = join(REPO_ROOT, 'apps', 'core', 'CHANGELOG.md');
export const ROOT_CHANGELOG_PATH = join(REPO_ROOT, 'CHANGELOG.md');

const VERSION_HEADING_RE = /^## (\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?)\s*$/m;

/**
 * Extrahiert den JÜNGSTEN Versionsabschnitt (`## X.Y.Z` bis zur nächsten
 * `## `-Überschrift oder Dateiende) aus einem von Changesets erzeugten
 * Paket-`CHANGELOG.md`. Gibt `null` zurück, wenn keine Versionsüberschrift
 * gefunden wird (z. B. noch nie versioniert).
 */
export function extractLatestSection(changelogMd) {
  const match = changelogMd.match(VERSION_HEADING_RE);
  if (!match || match.index === undefined) return null;
  const version = match[1];
  const startOfBody = match.index + match[0].length;
  const rest = changelogMd.slice(startOfBody);
  const nextHeadingMatch = rest.match(/^## /m);
  const body = (nextHeadingMatch && nextHeadingMatch.index !== undefined ? rest.slice(0, nextHeadingMatch.index) : rest).trim();
  return { version, body };
}

/**
 * Fügt einen Versionsabschnitt in das Root-`CHANGELOG.md` ein -- direkt
 * nach der `## [Unreleased]`-Überschrift, falls vorhanden, sonst an den
 * Dateianfang. Idempotent: existiert bereits ein `## [X.Y.Z]`-Abschnitt für
 * dieselbe Version, wird der Text unverändert zurückgegeben.
 */
export function mergeIntoRootChangelog(rootMd, version, body, { date = new Date().toISOString().slice(0, 10) } = {}) {
  const headingMarker = `## [${version}]`;
  if (rootMd.includes(headingMarker)) {
    return rootMd;
  }

  const section = `${headingMarker} - ${date}\n\n${body}\n`;
  const unreleasedRe = /^## \[Unreleased\]\s*$/m;
  const unreleasedMatch = rootMd.match(unreleasedRe);

  if (!unreleasedMatch || unreleasedMatch.index === undefined) {
    return `${rootMd.trimEnd()}\n\n${section}`;
  }

  // Nicht direkt HINTER die "## [Unreleased]"-Zeile einfuegen, sondern
  // hinter das ENDE des kompletten Unreleased-Abschnitts (Heading + dessen
  // eigener Platzhaltertext, bis zur naechsten "## "-Ueberschrift bzw.
  // Dateiende) -- sonst haengt der alte Unreleased-Platzhaltertext ohne
  // trennende Ueberschrift UNTER dem neu eingefuegten Versionsabschnitt und
  // wuerde faelschlich als dessen Body gelesen (extractRootSection).
  const afterUnreleasedHeading = unreleasedMatch.index + unreleasedMatch[0].length;
  const rest = rootMd.slice(afterUnreleasedHeading);
  const nextHeadingMatch = rest.match(/^## /m);
  const insertAt =
    nextHeadingMatch && nextHeadingMatch.index !== undefined
      ? afterUnreleasedHeading + nextHeadingMatch.index
      : rootMd.length;

  const before = rootMd.slice(0, insertAt).replace(/\n*$/, '\n\n');
  const after = rootMd.slice(insertAt);
  return `${before}${section}${after ? `\n${after}` : ''}`;
}

/**
 * Extrahiert den Textkörper eines bestimmten `## [X.Y.Z] - Datum`-
 * Abschnitts aus dem Root-`CHANGELOG.md` -- das, was
 * `.github/workflows/release.yml` als GitHub-Release-Notes-Body verwendet.
 * `null`, wenn die Version (noch) keinen Abschnitt hat.
 */
export function extractRootSection(rootMd, version) {
  const headingRe = new RegExp(`^## \\[${version.replace(/\./g, '\\.')}\\][^\\n]*\\n`, 'm');
  const match = rootMd.match(headingRe);
  if (!match || match.index === undefined) return null;
  const startOfBody = match.index + match[0].length;
  const rest = rootMd.slice(startOfBody);
  const nextHeadingMatch = rest.match(/^## /m);
  const body = (nextHeadingMatch && nextHeadingMatch.index !== undefined ? rest.slice(0, nextHeadingMatch.index) : rest).trim();
  return body;
}

function main() {
  const printSectionIdx = process.argv.indexOf('--print-section');
  if (printSectionIdx !== -1) {
    const version = process.argv[printSectionIdx + 1];
    if (!version) {
      console.error('--print-section braucht eine Versionsnummer, z. B. --print-section 1.2.0');
      process.exitCode = 1;
      return;
    }
    const rootChangelog = readFileSync(ROOT_CHANGELOG_PATH, 'utf-8');
    const section = extractRootSection(rootChangelog, version);
    if (section === null) {
      console.error(`CHANGELOG.md hat keinen Abschnitt für Version ${version}.`);
      process.exitCode = 1;
      return;
    }
    process.stdout.write(section + '\n');
    return;
  }

  if (!existsSync(PACKAGE_CHANGELOG_PATH)) {
    console.log(
      `${PACKAGE_CHANGELOG_PATH.slice(REPO_ROOT.length + 1)} existiert noch nicht -- ` +
        'vermutlich wurden noch nie Changesets versioniert ("pnpm changeset:version" zuerst ausführen). Nichts zu tun.',
    );
    return;
  }

  const packageChangelog = readFileSync(PACKAGE_CHANGELOG_PATH, 'utf-8');
  const latest = extractLatestSection(packageChangelog);
  if (!latest) {
    console.log('Keine Versionsüberschrift in apps/core/CHANGELOG.md gefunden -- nichts zu tun.');
    return;
  }

  const rootChangelog = readFileSync(ROOT_CHANGELOG_PATH, 'utf-8');
  const updated = mergeIntoRootChangelog(rootChangelog, latest.version, latest.body);
  if (updated === rootChangelog) {
    console.log(`CHANGELOG.md enthält bereits einen Abschnitt für ${latest.version} -- keine Änderung.`);
    return;
  }

  writeFileSync(ROOT_CHANGELOG_PATH, updated, 'utf-8');
  console.log(`CHANGELOG.md: Abschnitt für ${latest.version} aus apps/core/CHANGELOG.md übernommen.`);
}

const isMain = process.argv[1] !== undefined && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url));
if (isMain) {
  main();
}
