/**
 * Die Kopfpruefung der OSM-Extrakte — in zwei Skripten, in EINER Fassung.
 *
 * ─── WARUM ES DIESE PRUEFUNG GIBT ───────────────────────────────────────────
 * Im gemeinsamen Zwischenlager (`/share/yapaja/planetiler-sources`) liegen
 * die OSM-Extrakte aller installierten Regionen. Der Routinggraph wird ueber
 * JEDE Datei darin gebaut. Eine abgebrochene Uebertragung ist damit die
 * gefaehrlichste Datei des Systems: sie existiert, ist nicht leer, und der
 * Bau nimmt sie — mit einem Land, dem die Haelfte fehlt, und ohne eine
 * einzige Fehlermeldung. Der Betreiber merkt es erst, wenn eine Route mitten
 * im Nichts endet.
 *
 * ─── WARUM SIE ZWEIMAL IM QUELLTEXT STEHT ───────────────────────────────────
 * `services/tiles/build-pmtiles.sh` und
 * `yapaja_go/rootfs/usr/bin/yapaja-build-graph` sind zwei eigenstaendige
 * Shell-Programme, die an verschiedenen Orten im Image landen
 * (`/opt/yapaja/bin/` und `/usr/bin/`). Eine gemeinsame Datei zum Einbinden
 * waere ein dritter Pfad, der stimmen muss — und der bei einem
 * Verpackungsfehler ausfaellt, ohne dass die Pruefung fehlt: sie waere dann
 * schlicht nicht da.
 *
 * Die Duplikation ist also gewollt. Was NICHT gewollt ist, ist ein
 * stillschweigendes Auseinanderlaufen — deshalb dieser Test. Er vergleicht
 * die beiden Fassungen Zeichen fuer Zeichen UND fuehrt sie gegen echte
 * Bytefolgen aus, damit hier nicht bloss zwei gleich falsche Texte stehen.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Buffer } from 'node:buffer';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO = join(__dirname, '..', '..');
const BASH = existsSync('/bin/bash') ? '/bin/bash' : '/usr/bin/bash';

const KACHELBAU = join(REPO, 'services', 'tiles', 'build-pmtiles.sh');
const GRAPHBAU = join(REPO, 'yapaja_go', 'rootfs', 'usr', 'bin', 'yapaja-build-graph');

/** Schneidet die Funktion `ist_osm_pbf` aus einem Shell-Skript heraus. */
function funktionAus(datei: string): string {
  const text = readFileSync(datei, 'utf-8');
  const start = text.indexOf('ist_osm_pbf() {');
  if (start < 0) throw new Error(`ist_osm_pbf() fehlt in ${datei}`);
  const ende = text.indexOf('\n}\n', start);
  if (ende < 0) throw new Error(`ist_osm_pbf() ist in ${datei} nicht geschlossen`);
  return text.slice(start, ende + 3);
}

let work: string;

beforeEach(() => {
  work = mkdtempSync(join(tmpdir(), 'osm-pbf-kopf-'));
});
afterEach(() => {
  rmSync(work, { recursive: true, force: true });
});

/**
 * Ein echter OSM-PBF-Dateikopf.
 *
 * Laut Format: 4 Bytes Laenge des BlobHeader (big endian), dann der
 * BlobHeader als Protobuf — Feld 1 (`type`, Zeichenkette) ergibt das
 * Tag-Byte 0x0a, die Laenge 0x09 und die neun Zeichen "OSMHeader".
 */
function echterKopf(): Buffer {
  return Buffer.concat([
    Buffer.from([0x00, 0x00, 0x00, 0x0d]),
    Buffer.from([0x0a, 0x09]),
    Buffer.from('OSMHeader', 'ascii'),
  ]);
}

/** Fuehrt die Funktion aus dem gegebenen Skript gegen eine Datei aus. */
function pruefe(quelle: string, inhalt: Buffer): boolean {
  const datei = join(work, 'probe.bin');
  writeFileSync(datei, inhalt);
  const skript = join(work, 'lauf.sh');
  writeFileSync(skript, `set -uo pipefail\n${funktionAus(quelle)}\nist_osm_pbf "$1"\n`);
  try {
    execFileSync(BASH, [skript, datei], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

describe('ist_osm_pbf — beide Fassungen sind identisch', () => {
  it('Kachelbau und Graphbau tragen denselben Funktionstext', () => {
    // Zeichen fuer Zeichen. Eine der beiden zu verbessern und die andere zu
    // vergessen waere genau die Sorte Fehler, die hier nicht auffallen wuerde:
    // beide Wege fuehren zu einer Datei, die „irgendwie schon passt".
    expect(funktionAus(GRAPHBAU)).toBe(funktionAus(KACHELBAU));
  });

  it('beide Skripte tragen sie ueberhaupt', () => {
    expect(funktionAus(KACHELBAU)).toContain('OSMHeader');
    expect(funktionAus(GRAPHBAU)).toContain('OSMHeader');
  });
});

describe.each([
  ['build-pmtiles.sh', KACHELBAU],
  ['yapaja-build-graph', GRAPHBAU],
])('ist_osm_pbf in %s', (_name, quelle) => {
  it('erkennt einen echten Dateikopf', () => {
    expect(pruefe(quelle, Buffer.concat([echterKopf(), Buffer.alloc(4096, 0x11)]))).toBe(true);
  });

  it('lehnt eine leere Datei ab', () => {
    expect(pruefe(quelle, Buffer.alloc(0))).toBe(false);
  });

  it('lehnt eine abgeschnittene Datei ab', () => {
    // Genau der gefaehrliche Fall: die Uebertragung brach nach acht Bytes ab.
    expect(pruefe(quelle, echterKopf().subarray(0, 8))).toBe(false);
  });

  it('lehnt eine HTML-Fehlerseite ab', () => {
    // Der zweithaeufigste Fall: die URL leitet auf eine Anmeldeseite um, und
    // curl laedt brav 2 kB HTML mit Status 200.
    expect(
      pruefe(quelle, Buffer.from('<!DOCTYPE html>\n<title>404 Not Found</title>\n')),
    ).toBe(false);
  });

  it('lehnt eine Datei ab, in der "OSMHeader" an der falschen Stelle steht', () => {
    // Die Kennung muss an ihrem Platz stehen (Byte 6..14), nicht irgendwo.
    // Ein `grep -q OSMHeader` haette hier faelschlich zugestimmt.
    expect(
      pruefe(quelle, Buffer.concat([Buffer.alloc(64, 0x11), Buffer.from('OSMHeader')])),
    ).toBe(false);
  });

  it('lehnt eine PMTiles-Datei ab', () => {
    // Sie liegt im selben Verzeichnisbaum. Eine Verwechslung beim Ablegen von
    // Hand soll nicht als Extrakt durchgehen.
    expect(pruefe(quelle, Buffer.concat([Buffer.from('PM'), Buffer.alloc(200)]))).toBe(false);
  });
});
