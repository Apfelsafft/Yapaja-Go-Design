#!/usr/bin/env node
/**
 * Erzeugt die SDF-Glyphen für die Kartenbeschriftung neu.
 *
 * Die Ergebnisse liegen im Repo (`apps/web/public/fonts/`) — dieses Skript
 * wird also NICHT beim Bauen ausgeführt, sondern nur von Hand, wenn sich die
 * Schrift oder die abgedeckten Zeichenbereiche ändern sollen. Der Grund steht
 * in `apps/web/public/fonts/README.md`: das Add-on baut auf dem Gerät des
 * Betreibers, und jeder Download beim Bauen ist eine Stelle mehr, an der die
 * Installation scheitern kann.
 *
 * Aufruf:
 *   npm install fontnik@0.7.7
 *   node scripts/generate-glyphs.mjs <NotoSans-Regular.ttf> <NotoSans-Bold.ttf>
 */

import { createRequire } from 'node:module';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const fontnik = require('fontnik');

const OUT_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'apps', 'web', 'public', 'fonts');

/** Muss mit `FONT_RANGES` in `apps/core/src/map/styles/fonts.ts` übereinstimmen. */
const RANGES = [
  [0, 255],
  [256, 511],
  [512, 767],
  [768, 1023],
  [1024, 1279],
  [7680, 7935],
  [8192, 8447],
];

async function main() {
  const [regular, bold] = process.argv.slice(2);
  if (!regular || !bold) {
    console.error('Aufruf: node scripts/generate-glyphs.mjs <Regular.ttf> <Bold.ttf>');
    process.exit(1);
  }

  for (const [slug, ttf] of [
    ['noto-sans-regular', regular],
    ['noto-sans-bold', bold],
  ]) {
    const font = readFileSync(ttf);
    const dir = join(OUT_DIR, slug);
    mkdirSync(dir, { recursive: true });
    for (const [start, end] of RANGES) {
      const pbf = await new Promise((resolve, reject) => {
        fontnik.range({ font, start, end }, (err, data) => (err ? reject(err) : resolve(data)));
      });
      writeFileSync(join(dir, `${start}-${end}.pbf`), pbf);
    }
    console.log(`geschrieben: ${slug} (${RANGES.length} Bereiche)`);
  }
}

await main();
