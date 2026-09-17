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
/**
 * Die `substitutions:` der Konfiguration, als einfache Zuordnung.
 *
 * Gebraucht, weil der lambda-Block `${rund}` und Ähnliches enthält. ESPHome
 * ersetzt das VOR dem Übersetzen; ohne dieselbe Ersetzung prüfte dieser Lauf
 * C++, das es so nie gibt — und `${rund}` übersetzt ohnehin nicht.
 */
export function substitutionen(text) {
  const zeilen = text.split('\n');
  const start = zeilen.findIndex((z) => /^substitutions:\s*$/.test(z));
  if (start < 0) return {};
  const werte = {};
  for (const zeile of zeilen.slice(start + 1)) {
    if (zeile.trim() === '' || zeile.trimStart().startsWith('#')) continue;
    if (!/^\s/.test(zeile)) break;
    const treffer = zeile.match(/^\s+([A-Za-z0-9_]+):\s*(.*)$/);
    if (treffer) werte[treffer[1]] = treffer[2].trim().replace(/^"(.*)"$/, '$1');
  }
  return werte;
}

/**
 * Welche `id(...)` ein ZEIGER ist und welche ein WERT.
 *
 * ─── WARUM DIESE TABELLE DER KERN DIESER DATEI IST ──────────────────────────
 * ESPHome setzt `id(name)` nicht in ein Objekt um, sondern in die C++-Variable
 * selbst — und die ist bei Komponenten ein ZEIGER. Nachgelesen in ESPHomes
 * `cpp_generator.py` (`process_lambda`):
 *
 *   if parts[i * 3 + 2] == ".":
 *       parts[i * 3 + 1] = var._     // ergibt "name->"
 *   else:
 *       parts[i * 3 + 1] = var       // ergibt "name"  -- der Zeiger
 *
 * Diese Prüfung hat das bis 0.11.1 FALSCH nachgebaut: sie definierte
 * `id(name)` als Objekt, damit `id(name).state` übersetzt. Damit übersetzte
 * auch `hilfsfunktion(id(name))` — auf dem Gerät aber nicht, denn dort geht
 * ein Zeiger hinein. Der Bau brach nach über tausend Übersetzungsschritten ab:
 *
 *   no known conversion for argument 1 from
 *   'esphome::homeassistant::HomeassistantSensor* const'
 *   to 'esphome::sensor::Sensor&'
 *
 * Eine Prüfung, die eine ANNAHME nachbaut statt der Wirklichkeit, prüft die
 * Annahme. Sie ist dann schlimmer als keine: sie gibt Sicherheit, die es nicht
 * gibt. Deshalb bildet dieser Lauf jetzt dieselbe Umschreibung nach.
 *
 * Nicht alles ist ein Zeiger: `color:` erzeugt einen WERT (`cg.variable`),
 * Komponenten einen Zeiger (`cg.new_Pvariable`). Deshalb zwei Listen.
 */
export const ZEIGER_IDS = new Set([
  'font_xl', 'font_l', 'font_m', 'font_s',
  'yapaja_tempo', 'yapaja_tempolimit', 'yapaja_manoever_entfernung',
  'yapaja_reststrecke', 'yapaja_zu_schnell', 'yapaja_anweisung',
  'yapaja_manoever_art', 'yapaja_fahrzustand', 'yapaja_ankunft',
]);

export const WERT_IDS = new Set([
  'c_hintergrund', 'c_text', 'c_gedaempft', 'c_pfeil', 'c_warnung', 'c_gut',
  'c_schild',
]);

/**
 * Entfernt Kommentare, so wie ESPHome es vor dem Suchen der Kennungen tut.
 *
 * Nachgelesen in `esphome/core/__init__.py`, Methode `Lambda.comment_remover`:
 * ein Muster über Zeilenkommentare, Blockkommentare und Zeichenketten; was
 * mit einem Schrägstrich beginnt, wird durch EIN Leerzeichen ersetzt, alles
 * andere bleibt stehen. Dasselbe Muster steht unten in JavaScript.
 *
 * Ohne diesen Schritt hielte dieser Lauf ein `id(...)` in einem KOMMENTAR für
 * echt — und genau das ist beim ersten Versuch passiert: der Satz, der die
 * Bedeutung von `id(...)` erklärt, enthielt selbst ein solches Vorkommen.
 *
 * Zeichenketten bleiben unangetastet; nur Kommentare verschwinden. Der
 * Zeilenumbruch bleibt erhalten, damit Fehlermeldungen des Übersetzers weiter
 * auf die richtige Zeile zeigen.
 */
export function ohneKommentare(text) {
  return text.replace(
    /\/\/.*?$|\/\*[\s\S]*?\*\/|'(?:\\.|[^\\'])*'|"(?:\\.|[^\\"])*"/gm,
    (treffer) => (treffer.startsWith('/') ? ' ' : treffer),
  );
}

/**
 * Setzt `id(...)` genau so um, wie ESPHome es tut.
 *
 * Ein unbekannter Name bricht ab, statt durchgelassen zu werden. Sonst
 * entstünde beim nächsten neuen Sensor genau dieselbe Lücke noch einmal —
 * eine Prüfung, die still an ihm vorbeiläuft.
 */
export function idsUmschreiben(rumpf) {
  return rumpf.replace(/id\(\s*([A-Za-z_][A-Za-z0-9_]*)\s*\)(\.?)/g, (_ganz, name, punkt) => {
    if (ZEIGER_IDS.has(name)) return punkt ? `${name}->` : name;
    if (WERT_IDS.has(name)) return punkt ? `${name}.` : name;
    throw new Error(
      `id(${name}) ist in run.mjs weder als Zeiger noch als Wert eingetragen. ` +
        'Ohne diesen Eintrag prüft dieser Lauf etwas anderes als das Gerät übersetzt.',
    );
  });
}

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
  const roh = rumpf.join('\n').replace(/\n+$/, '');

  // Dieselbe Ersetzung, die ESPHome vornimmt. Bleibt danach ein `${…}` übrig,
  // ist das ein Tippfehler in der Konfiguration — und der soll hier auffallen
  // und nicht erst beim Übersetzen auf dem Gerät.
  const werte = substitutionen(text);
  const ersetzt = roh.replace(/\$\{([A-Za-z0-9_]+)\}/g, (ganz, name) => {
    if (!(name in werte)) throw new Error(`\${${name}} hat keine Entsprechung unter substitutions:`);
    return werte[name];
  });
  // Und zuletzt dieselben zwei Schritte wie ESPHome: Kommentare raus, dann
  // die Kennungen umschreiben. Erst danach ist das hier derselbe C++-Text,
  // den auch das Gerät übersetzt.
  return idsUmschreiben(ohneKommentare(ersetzt));
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
