#!/usr/bin/env node
/**
 * Erzeugt die gerahmten Straßenschilder (Autobahn blau, Bundesstraße gelb).
 *
 * ─── WOFÜR ──────────────────────────────────────────────────────────────────
 * Gewünscht: „Du kannst auch gerne die gerahmten Schilder mit den
 * Bezeichnungen der Straßen einbauen. Blau und gelb. Das sieht toll aus."
 *
 * Seit 0.8.14 stehen die Nummern als Fettschrift auf der Karte. Ein Rahmen
 * braucht ein BILD — MapLibre kennt keine Kästchen um Text, es kennt nur
 * Symbole aus einem Sprite. Genau das erzeugt dieses Skript.
 *
 * ─── WIE EIN BILD ZU BELIEBIG LANGEM TEXT PASST ─────────────────────────────
 * „A 61" und „A 5" sind verschieden breit. Ein Schild je Nummer zu erzeugen
 * wäre aussichtslos. MapLibre kann ein Symbol aber DEHNEN: `stretchX`/
 * `stretchY` im Sprite sagen, welcher Streifen sich strecken darf, `content`
 * sagt, wo der Text hineingehört, und `icon-text-fit` im Stil zieht beides
 * zusammen. Die Ecken bleiben dabei scharf, nur die Mitte wächst.
 *
 * ─── WARUM OHNE BIBLIOTHEK ──────────────────────────────────────────────────
 * Aus demselben Grund wie bei den Glyphen (siehe `generate-glyphs.mjs`): das
 * Ergebnis liegt im Repo, das Add-on baut auf dem Gerät des Betreibers, und
 * jede Abhängigkeit beim Bauen ist eine Stelle mehr, an der die Installation
 * scheitern kann. Ein PNG zu schreiben braucht nur `zlib`, und das bringt
 * Node mit.
 *
 * Aufruf:
 *   node scripts/generate-shield-sprites.mjs
 *
 * Das Ergebnis gehört eingecheckt. `shieldSprites.test.ts` prüft, dass die
 * Dateien im Repo zu diesem Skript passen — wer eine Farbe ändert und das
 * Erzeugen vergisst, bekommt es gesagt.
 */

import { deflateSync } from 'node:zlib';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const OUT_DIR = join(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  'apps',
  'web',
  'public',
  'sprites',
);

/** Basisname; MapLibre hängt `.json`/`.png` und `@2x` selbst an. */
export const SPRITE_NAME = 'yapaja';

// ───────────────────────────── Die Schilder ─────────────────────────────────

/**
 * Die drei Formen, nach deutschem Vorbild — und nach der OSM-Klasse, nicht
 * nach dem Buchstaben in der Nummer.
 *
 * Warum nach der Klasse: die Nummer selbst ist landesabhängig („A 61" in
 * Deutschland, „D5" in Tschechien, „E35" als Europastraße). Die Klasse
 * `motorway`/`trunk`/`primary` ist dagegen dieselbe Angabe in ganz Europa.
 * Die Farben stimmen damit für den ganzen deutschsprachigen Raum und die
 * meisten Nachbarn; ein Land mit anderer Beschilderung bekäme die falsche
 * Farbe, und das ist ein bewusster Handel gegen eine Landkarte voller
 * Sonderfälle.
 */
export const SHIELDS = [
  {
    id: 'shield-motorway',
    /** Autobahnblau. */
    fuellung: [0x0b, 0x4e, 0xa2, 0xff],
    rahmen: [0xff, 0xff, 0xff, 0xff],
    /** Die Textfarbe steht im Stil, nicht im Bild — hier nur dokumentiert. */
    text: '#FFFFFF',
  },
  {
    id: 'shield-trunk',
    /** Bundesstraßengelb. */
    fuellung: [0xf2, 0xc4, 0x0c, 0xff],
    rahmen: [0x1a, 0x1a, 0x1a, 0xff],
    text: '#1A1A1A',
  },
  {
    id: 'shield-minor',
    /** Landes- und Kreisstraßen: weiß mit schwarzem Rand. */
    fuellung: [0xff, 0xff, 0xff, 0xff],
    rahmen: [0x1a, 0x1a, 0x1a, 0xff],
    text: '#1A1A1A',
  },
];

/** Maße in logischen Punkten (Pixelverhältnis 1). */
export const MASSE = {
  breite: 22,
  hoehe: 15,
  radius: 3,
  /** Stärke des Rahmens. */
  rand: 1.5,
  /** Abstand des Rahmens zum Bildrand — sonst wird er beim Skalieren weich. */
  einzug: 1,
};

/**
 * Wo das Bild wachsen darf und wo der Text hingehört.
 *
 * Ein SCHMALER Streifen in der Mitte: alles andere (Ecken, Rahmen) bleibt
 * unverzerrt. Würde man das ganze Bild dehnen, würden runde Ecken bei „A 61"
 * zu Ellipsen.
 */
export function dehnbereiche(skala) {
  const b = MASSE.breite * skala;
  const h = MASSE.hoehe * skala;
  const ein = (MASSE.einzug + MASSE.rand) * skala;
  return {
    stretchX: [[Math.round(b / 2 - skala), Math.round(b / 2 + skala)]],
    stretchY: [[Math.round(h / 2 - skala), Math.round(h / 2 + skala)]],
    // Der Text sitzt innerhalb des Rahmens, mit etwas Luft.
    content: [
      Math.round(ein + skala),
      Math.round(ein + skala * 0.5),
      Math.round(b - ein - skala),
      Math.round(h - ein - skala * 0.5),
    ],
  };
}

// ─────────────────────────── Zeichnen (ohne Canvas) ─────────────────────────

/**
 * Deckung eines Pixels durch ein abgerundetes Rechteck, 4×4 überabgetastet.
 *
 * Überabtastung statt exakter Kantenglättung, weil sie für jede Form
 * funktioniert und in fünf Zeilen stimmt. Bei 16 Proben je Pixel ist der
 * Treppeneffekt auf einem 44 px breiten Schild nicht mehr zu sehen.
 */
function deckung(px, py, x0, y0, x1, y1, r) {
  const PROBEN = 4;
  let treffer = 0;
  for (let sy = 0; sy < PROBEN; sy++) {
    for (let sx = 0; sx < PROBEN; sx++) {
      const x = px + (sx + 0.5) / PROBEN;
      const y = py + (sy + 0.5) / PROBEN;
      if (x < x0 || x > x1 || y < y0 || y > y1) continue;
      // Nur in den vier Eckquadraten muss der Radius geprüft werden.
      const dx = x < x0 + r ? x0 + r - x : x > x1 - r ? x - (x1 - r) : 0;
      const dy = y < y0 + r ? y0 + r - y : y > y1 - r ? y - (y1 - r) : 0;
      if (dx * dx + dy * dy <= r * r) treffer++;
    }
  }
  return treffer / (PROBEN * PROBEN);
}

function mischen(unten, oben, alpha) {
  return Math.round(unten * (1 - alpha) + oben * alpha);
}

/** Zeichnet ein Schild in einen RGBA-Puffer an die Stelle (ox, oy). */
export function zeichneSchild(puffer, blattBreite, ox, oy, schild, skala) {
  const b = MASSE.breite * skala;
  const h = MASSE.hoehe * skala;
  const r = MASSE.radius * skala;
  const ein = MASSE.einzug * skala;
  const rand = MASSE.rand * skala;

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < b; x++) {
      // Aussen: der Rahmen. Innen: die Fuellung. Die Deckung beider Formen
      // wird uebereinandergelegt, damit die Innenkante ebenso weich wird.
      const aussen = deckung(x, y, ein, ein, b - ein, h - ein, r);
      const innen = deckung(
        x,
        y,
        ein + rand,
        ein + rand,
        b - ein - rand,
        h - ein - rand,
        Math.max(0, r - rand),
      );
      if (aussen <= 0) continue;

      const i = ((oy + y) * blattBreite + (ox + x)) * 4;
      // Erst den Rahmen auf das (durchsichtige) Blatt, dann die Fuellung
      // darauf. Genau die Reihenfolge, in der man es auch malen wuerde.
      for (let k = 0; k < 3; k++) {
        puffer[i + k] = mischen(puffer[i + k], schild.rahmen[k], aussen);
      }
      puffer[i + 3] = mischen(puffer[i + 3], 255, aussen);
      for (let k = 0; k < 3; k++) {
        puffer[i + k] = mischen(puffer[i + k], schild.fuellung[k], innen);
      }
    }
  }
}

// ───────────────────────────── PNG schreiben ────────────────────────────────

const CRC_TABELLE = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();

function crc32(buf) {
  let c = -1;
  for (let i = 0; i < buf.length; i++) c = CRC_TABELLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}

function chunk(typ, daten) {
  const laenge = Buffer.alloc(4);
  laenge.writeUInt32BE(daten.length, 0);
  const koerper = Buffer.concat([Buffer.from(typ, 'latin1'), daten]);
  const pruef = Buffer.alloc(4);
  pruef.writeUInt32BE(crc32(koerper), 0);
  return Buffer.concat([laenge, koerper, pruef]);
}

/** 8-Bit-RGBA-PNG (Farbtyp 6), ohne Filter — die Blätter sind winzig. */
export function alsPng(rgba, breite, hoehe) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(breite, 0);
  ihdr.writeUInt32BE(hoehe, 4);
  ihdr[8] = 8; // Bittiefe
  ihdr[9] = 6; // RGBA
  ihdr[10] = 0; // Deflate
  ihdr[11] = 0; // Standardfilter
  ihdr[12] = 0; // kein Interlace

  const roh = Buffer.alloc((breite * 4 + 1) * hoehe);
  for (let y = 0; y < hoehe; y++) {
    roh[y * (breite * 4 + 1)] = 0; // Filtertyp „keiner"
    rgba.copy(roh, y * (breite * 4 + 1) + 1, y * breite * 4, (y + 1) * breite * 4);
  }

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(roh, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

// ────────────────────────────── Das Blatt ───────────────────────────────────

/** Abstand zwischen den Symbolen, damit beim Skalieren nichts überläuft. */
const LUECKE = 2;

/** Erzeugt Blatt und Beschreibung für ein Pixelverhältnis. */
export function baueBlatt(skala) {
  const b = Math.round(MASSE.breite * skala);
  const h = Math.round(MASSE.hoehe * skala);
  const blattBreite = SHIELDS.length * b + (SHIELDS.length - 1) * LUECKE;
  const puffer = Buffer.alloc(blattBreite * h * 4, 0);

  const bereiche = dehnbereiche(skala);
  const beschreibung = {};
  SHIELDS.forEach((schild, n) => {
    const ox = n * (b + LUECKE);
    zeichneSchild(puffer, blattBreite, ox, 0, schild, skala);
    beschreibung[schild.id] = {
      x: ox,
      y: 0,
      width: b,
      height: h,
      pixelRatio: skala,
      ...bereiche,
    };
  });

  return { png: alsPng(puffer, blattBreite, h), beschreibung, blattBreite, hoehe: h };
}

function main() {
  mkdirSync(OUT_DIR, { recursive: true });
  for (const skala of [1, 2]) {
    const { png, beschreibung } = baueBlatt(skala);
    const endung = skala === 1 ? '' : `@${skala}x`;
    writeFileSync(join(OUT_DIR, `${SPRITE_NAME}${endung}.png`), png);
    writeFileSync(
      join(OUT_DIR, `${SPRITE_NAME}${endung}.json`),
      `${JSON.stringify(beschreibung, null, 2)}\n`,
    );
  }
  // eslint-disable-next-line no-console -- ein Werkzeug, kein Dienst.
  console.log(`Schilder geschrieben nach ${OUT_DIR}`);
}

if (process.argv[1] && process.argv[1].endsWith('generate-shield-sprites.mjs')) {
  main();
}
