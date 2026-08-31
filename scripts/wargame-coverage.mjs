#!/usr/bin/env node
/**
 * wargame-coverage.mjs — W-ID-Abgleich-Skript (E10-T5, Pflicht-Test).
 *
 * Prüft: jedes in `docs/08-wargame.md` als 🔴 (sicherheitsrelevant) oder 🟠
 * (funktionskritisch) markierte Wargame-Szenario hat einen Eintrag in
 * `docs/troubleshooting.md`. Die Liste der geforderten W-IDs wird bei JEDEM
 * Lauf frisch aus `docs/08-wargame.md` abgeleitet ("### W-nn <Emoji> ...")
 * — es gibt hier BEWUSST keine hartkodierte Liste. Wird ein Wargame neu
 * angelegt oder seine Einstufung geändert (🟡 -> 🟠 z. B.), greift die
 * Prüfung beim naechsten Lauf automatisch ohne Code-Änderung an diesem
 * Skript.
 *
 * `docs/troubleshooting.md` muss jeden geforderten Fall als eigene
 * Überschrift der Form `## W-nn — ...` führen (siehe Datei selbst) — ein
 * bloßes Vorkommen der ID im Fließtext (z. B. in einem Querverweis) zählt
 * NICHT als Abdeckung, sonst könnte ein einziger "siehe auch W-14"-Satz das
 * Gate faelschlich gruen faerben.
 *
 * Verwendung:
 *   node scripts/wargame-coverage.mjs           # Bericht (Tabelle) ausgeben
 *   node scripts/wargame-coverage.mjs --check    # zusätzlich: Exit 1 bei Lücke
 */

import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = resolve(__dirname, '..');
export const WARGAME_PATH = join(REPO_ROOT, 'docs', '08-wargame.md');
export const TROUBLESHOOTING_PATH = join(REPO_ROOT, 'docs', 'troubleshooting.md');

/** Schweregrade, die eine Troubleshooting-Pflicht auslösen (docs/08 §Legende). */
export const REQUIRED_SEVERITIES = ['🔴', '🟠'];

/**
 * Findet jede Wargame-Überschrift `### W-nn <Emoji> Titel` und gibt
 * `{ id, severity, title }` je Treffer zurück, in Dokument-Reihenfolge.
 */
export function extractWargameEntries(markdown) {
  const headingRe = /^### (W-\d+) (🔴|🟠|🟡)\s+(.+)$/gm;
  const entries = [];
  let match;
  while ((match = headingRe.exec(markdown)) !== null) {
    entries.push({ id: match[1], severity: match[2], title: match[3].trim() });
  }
  return entries;
}

/** W-IDs mit Schweregrad 🔴 oder 🟠, sortiert (numerisch nach ID). */
export function requiredWIds(markdown) {
  const entries = extractWargameEntries(markdown);
  const ids = entries.filter((e) => REQUIRED_SEVERITIES.includes(e.severity)).map((e) => e.id);
  return sortWIds(ids);
}

function sortWIds(ids) {
  return [...ids].sort((a, b) => Number(a.slice(2)) - Number(b.slice(2)));
}

/**
 * Findet jede Troubleshooting-Überschrift `## W-nn — ...` (Em-Dash oder
 * einfacher Bindestrich, beide in der Praxis vorkommend) und gibt die
 * Menge der dort behandelten W-IDs zurück.
 */
export function extractDocumentedWIds(markdown) {
  const headingRe = /^## (W-\d+)\s*[—-]/gm;
  const ids = new Set();
  let match;
  while ((match = headingRe.exec(markdown)) !== null) {
    ids.add(match[1]);
  }
  return ids;
}

/** W-IDs aus `required`, die in `documented` fehlen (Reihenfolge wie `required`). */
export function findMissing(required, documented) {
  return required.filter((id) => !documented.has(id));
}

/** W-IDs, die im Troubleshooting-Doc stehen, aber laut Wargame gar keine Pflicht sind (Hinweis, kein Fehler). */
export function findExtra(required, documented) {
  const requiredSet = new Set(required);
  return sortWIds([...documented].filter((id) => !requiredSet.has(id)));
}

function buildReport({ wargameEntries, required, documented, missing, extra }) {
  const bySeverity = Object.fromEntries(wargameEntries.map((e) => [e.id, e.severity]));
  const rows = required.map((id) => {
    const covered = documented.has(id);
    return `| ${id} | ${bySeverity[id] ?? '?'} | ${covered ? '✅ abgedeckt' : '❌ FEHLT'} |`;
  });
  const lines = [
    `W-ID-Abgleich: ${required.length} Pflichtfälle (🔴/🟠) aus docs/08-wargame.md, ${
      required.length - missing.length
    } davon in docs/troubleshooting.md abgedeckt.`,
    '',
    '| W-ID | Schweregrad | Status |',
    '|---|---|---|',
    ...rows,
  ];
  if (extra.length > 0) {
    lines.push('', `Hinweis: dokumentiert, aber laut Wargame nicht 🔴/🟠 (kein Fehler): ${extra.join(', ')}`);
  }
  return lines.join('\n');
}

function main() {
  const check = process.argv.includes('--check');
  const wargameMd = readFileSync(WARGAME_PATH, 'utf-8');
  const troubleshootingMd = readFileSync(TROUBLESHOOTING_PATH, 'utf-8');

  const wargameEntries = extractWargameEntries(wargameMd);
  if (wargameEntries.length === 0) {
    console.error(`Keine Wargame-Überschriften in ${WARGAME_PATH} gefunden -- Regex/Format geprüft?`);
    process.exitCode = 1;
    return;
  }

  const required = requiredWIds(wargameMd);
  const documented = extractDocumentedWIds(troubleshootingMd);
  const missing = findMissing(required, documented);
  const extra = findExtra(required, documented);

  console.log(buildReport({ wargameEntries, required, documented, missing, extra }));

  if (check && missing.length > 0) {
    console.error(
      `\nFEHLER: ${missing.length} 🔴/🟠-Wargame-Fall/Fälle ohne Troubleshooting-Eintrag: ${missing.join(', ')}`,
    );
    process.exitCode = 1;
  }
}

const isMain = process.argv[1] !== undefined && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url));
if (isMain) {
  main();
}
