#!/usr/bin/env node
/**
 * Zeichnet die Anzeige in ein Pixelfeld und gibt sie als ASCII aus.
 *
 * ─── WARUM ES DAS NEBEN `run.mjs` GIBT ──────────────────────────────────────
 * `run.mjs` prüft. Dieses Werkzeug zeigt.
 *
 * Die Zeichenprüfung merkt sich nur die äussersten Punkte und die Texte.
 * Damit fängt sie Tippfehler, falsche Argumentzahlen und Zeichnungen, die aus
 * dem Bild laufen — aber nicht die Frage, ob ein Fahrzeug wie ein Fahrzeug
 * AUSSIEHT.
 *
 * Genau daran sind in diesem Projekt schon drei Zeichnungen gescheitert: der
 * Leitkegel, die Mülltonne und der Wasserhahn. Jedes Mal waren alle Tests
 * grün, und erst das vergrösserte Hinsehen hat gezeigt, dass die Form in
 * Krümel zerfällt.
 *
 * Und einmal hat es einen ENTWURFSFEHLER gefunden, den kein Test hätte finden
 * können: die Fahrzeugansicht war massstabsgetreu gedreht. Bei realistischen
 * 1,5 Grad sind das über neunzig Bildpunkte gerade zwei — ein schiefes
 * Fahrzeug sah aus wie ein gerades. Die Zahlen daneben stimmten, jeder Test
 * war grün, und die Anzeige war trotzdem nutzlos.
 *
 * ─── DIES IST KEIN TEST ─────────────────────────────────────────────────────
 * Es fällt nie durch und läuft nicht in der CI. Es ist zum Ansehen:
 *
 *   node esphome/test/bild.mjs
 */

import { readFileSync, writeFileSync, mkdtempSync, copyFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { lambdaRumpf } from './run.mjs';

const HIER = dirname(fileURLToPath(import.meta.url));
const YAML = join(HIER, '..', 'yapaja-nav-display.yaml');

function main() {
  const bau = mkdtempSync(join(tmpdir(), 'yapaia-bild-'));
  writeFileSync(join(bau, 'lambda_body.inc'), lambdaRumpf(readFileSync(YAML, 'utf-8')));
  copyFileSync(join(HIER, 'bildpruefung.cpp'), join(bau, 'bild.cpp'));

  const programm = join(bau, 'bild');
  execFileSync('g++', ['-std=c++17', '-O1', `-I${bau}`, join(bau, 'bild.cpp'), '-o', programm], {
    stdio: 'inherit',
  });
  execFileSync(programm, { stdio: 'inherit' });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main();
}
