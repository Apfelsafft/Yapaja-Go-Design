#!/usr/bin/env node
/**
 * Übersetzt und führt die Zeichenroutine aus `yapaja-nav-display.yaml` aus.
 *
 * ─── WARUM DAS ÜBERHAUPT PRÜFBAR SEIN MUSS ──────────────────────────────────
 * Eine ESPHome-Konfiguration wird sonst erst auf dem Gerät übersetzt. Ein
 * Tippfehler in der Zeichenroutine fällt dann nach einem mehrminütigen Build
 * auf — oder gar nicht, weil er übersetzt und nur falsch zeichnet. Genau das
 * ist hier schon passiert: `id(...)` liefert in ESPHome das Objekt und keinen
 * Zeiger, und ein Pfeil lief auf schmalen Panels aus dem Bild.
 *
 * Die Routine ist gewöhnliches C++. `zeichenpruefung.cpp` bildet die
 * ESPHome-Zeichen-API mit denselben Signaturen nach, führt die Routine gegen
 * erfundene Werte aus und prüft, WAS dabei herauskommt: welcher Pfeil, wohin
 * er zeigt, welche Texte erscheinen — und vor allem, welche NICHT erscheinen,
 * wenn ein Wert unbekannt ist.
 *
 * Gebraucht wird nur ein C++-Übersetzer. ESPHome selbst nicht.
 *
 *   node esphome/test/run.mjs
 */

import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';

const HIER = dirname(fileURLToPath(import.meta.url));
const YAML = join(HIER, '..', 'yapaja-nav-display.yaml');

/**
 * Holt den Rumpf des `lambda: |-`-Blocks aus der Konfiguration.
 *
 * Von Hand statt mit einer YAML-Bibliothek: so braucht dieser Lauf keine
 * Abhängigkeit, die es auf einem frischen Rechner erst zu installieren gäbe.
 * Ein eingerückter Block in YAML ist einfach genug dafür — und wenn die
 * Annahme einmal nicht mehr stimmt, findet sich hier gar kein Rumpf und der
 * Lauf bricht ab, statt stillschweigend nichts zu prüfen.
 */
export function lambdaRumpf(text) {
  const zeilen = text.split('\n');
  const start = zeilen.findIndex((z) => /^\s*lambda:\s*\|-?\s*$/.test(z));
  if (start < 0) throw new Error('Kein "lambda: |-" in der Konfiguration gefunden');

  const einzug = zeilen[start].match(/^\s*/)[0].length;
  const rumpf = [];
  for (const zeile of zeilen.slice(start + 1)) {
    if (zeile.trim() !== '' && zeile.match(/^\s*/)[0].length <= einzug) break;
    rumpf.push(zeile.slice(einzug + 2));
  }
  if (rumpf.length === 0) throw new Error('Der lambda-Block ist leer');
  // `|-` schneidet den abschliessenden Umbruch ab. Ohne das hier stimmt das
  // Ergebnis zeichengenau NICHT mit dem überein, was ESPHome einliest --
  // belanglos für den Übersetzer, aber dieser Lauf soll genau das prüfen,
  // was ausgeliefert wird, und nicht etwas Ähnliches.
  return rumpf.join('\n').replace(/\n+$/, '');
}

function main() {
  const rumpf = lambdaRumpf(readFileSync(YAML, 'utf-8'));
  console.log(`Zeichenroutine: ${rumpf.split('\n').length} Zeilen\n`);

  const bau = mkdtempSync(join(tmpdir(), 'yapaja-esphome-'));
  writeFileSync(join(bau, 'lambda_body.inc'), rumpf);

  const programm = join(bau, 'pruefung');
  try {
    execFileSync(
      'g++',
      ['-std=c++17', '-O1', `-I${bau}`, join(HIER, 'zeichenpruefung.cpp'), '-o', programm],
      { stdio: 'inherit' },
    );
  } catch {
    console.error(
      '\n::error::Die Zeichenroutine übersetzt nicht. Auf dem Gerät wäre das ein\n' +
        'fehlgeschlagener ESPHome-Build — nur eben erst nach dem Flashen.',
    );
    process.exit(1);
  }

  try {
    execFileSync(programm, { stdio: 'inherit' });
  } catch {
    console.error('\n::error::Die Zeichenroutine zeichnet etwas anderes als erwartet.');
    process.exit(1);
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main();
}
