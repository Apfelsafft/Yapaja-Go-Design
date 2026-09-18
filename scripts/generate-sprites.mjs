#!/usr/bin/env node
/**
 * Erzeugt die Bildsymbole der Karte: Straßenschilder und POI-Marken.
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
 *   node scripts/generate-sprites.mjs
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


// ─────────────────────────── POI-Marken ─────────────────────────────────────

/**
 * Die Kategorien, die auf der Karte ein Symbol bekommen — ausgesucht fuer ein
 * Wohnmobil, nicht fuer eine Stadtkarte.
 *
 * Gewuenscht: „Koennen wir auch poi's wie bei Google Maps einfuegen?
 * Restaurants, Womo Stellplaetze, Parkplaetze, Campingplaetze, Superm[a]erkte,
 * Sehenswuerdigkeiten usw?"
 *
 * Jede Form ist WEISS auf einer farbigen Scheibe -- dieselbe Bauart wie bei
 * Google Maps, und der Grund dafuer ist praktisch: auf einer Karte mit Wald,
 * Feldern und Wasser ist die Farbe das Einzige, was aus dem Augenwinkel
 * funktioniert, und Weiss ist die einzige Fuellung, die auf JEDER dieser
 * Farben steht.
 *
 * Die Koordinaten liegen in einem 12x12-Feld. Es sitzt mittig auf der
 * Scheibe; (6,6) ist also die Mitte.
 */
export const POI_MARKEN = [
  {
    id: 'poi-wohnmobil',
    farbe: [0xd9, 0x53, 0x2c, 0xff], // Rotorange -- die wichtigste Kategorie
    formen: [
      { typ: 'rechteck', x: 0.8, y: 3.2, b: 9.2, h: 4.6, r: 1.1 },
      { typ: 'kreis', x: 3.1, y: 8.4, r: 1.3 },
      { typ: 'kreis', x: 7.7, y: 8.4, r: 1.3 },
    ],
  },
  {
    id: 'poi-camping',
    farbe: [0x2e, 0x7d, 0x32, 0xff], // Gruen
    formen: [
      { typ: 'polygon', punkte: [[6, 1.6], [10.8, 10], [1.2, 10]] },
      // Der Eingang -- ohne ihn ist es nur ein Dreieck.
      { typ: 'polygon', punkte: [[6, 6.2], [7.3, 10], [4.7, 10]], loch: true },
    ],
  },
  {
    id: 'poi-tanken',
    farbe: [0x1e, 0x6f, 0xb8, 0xff], // Blau
    formen: [
      { typ: 'rechteck', x: 1.6, y: 1.6, b: 5.4, h: 8.8, r: 0.9 },
      { typ: 'rechteck', x: 2.9, y: 2.9, b: 2.8, h: 2.2, r: 0.4, loch: true },
      { typ: 'rechteck', x: 7.0, y: 4.0, b: 2.0, h: 0.9, r: 0.3 },
      { typ: 'rechteck', x: 8.3, y: 4.0, b: 0.9, h: 5.0, r: 0.4 },
    ],
  },
  {
    id: 'poi-laden',
    farbe: [0x00, 0x87, 0x7a, 0xff], // Tuerkis
    formen: [
      { typ: 'polygon', punkte: [[7.4, 1.2], [2.6, 6.9], [5.3, 6.9], [4.6, 10.8], [9.4, 4.8], [6.6, 4.8]] },
    ],
  },
  {
    id: 'poi-parken',
    farbe: [0x3f, 0x51, 0xb5, 0xff], // Indigo -- wie das Verkehrszeichen
    formen: [
      { typ: 'rechteck', x: 3.0, y: 1.4, b: 2.2, h: 9.2, r: 0.3 },
      // Beginnt links BEIM STIEL, nicht daneben: sonst rundet der Bauch auch
      // links ab und haengt frei in der Luft -- er las sich dann als Fahne.
      { typ: 'rechteck', x: 3.0, y: 1.4, b: 6.0, h: 5.0, r: 2.4 },
      // Die Punze. Sie muss vollstaendig INNERHALB des Bauchs liegen und
      // links am Stiel anschliessen, sonst laeuft sie aus.
      { typ: 'rechteck', x: 5.2, y: 3.2, b: 1.9, h: 1.6, r: 0.7, loch: true },
    ],
  },
  {
    id: 'poi-einkaufen',
    farbe: [0xef, 0x6c, 0x00, 0xff], // Orange
    formen: [
      { typ: 'polygon', punkte: [[1.6, 4.4], [10.4, 4.4], [9.2, 10.6], [2.8, 10.6]] },
      // Henkel, als Buegel aus zwei Zuegen.
      { typ: 'polygon', punkte: [[4.0, 4.4], [4.0, 3.0], [8.0, 3.0], [8.0, 4.4], [7.0, 4.4], [7.0, 4.0], [5.0, 4.0], [5.0, 4.4]] },
    ],
  },
  {
    id: 'poi-essen',
    farbe: [0xc2, 0x18, 0x5b, 0xff], // Himbeere
    formen: [
      // Gabel: Stiel und drei Zinken.
      { typ: 'rechteck', x: 2.6, y: 5.0, b: 1.4, h: 5.6, r: 0.4 },
      { typ: 'rechteck', x: 1.5, y: 1.4, b: 0.9, h: 4.0, r: 0.3 },
      { typ: 'rechteck', x: 2.85, y: 1.4, b: 0.9, h: 4.0, r: 0.3 },
      { typ: 'rechteck', x: 4.2, y: 1.4, b: 0.9, h: 4.0, r: 0.3 },
      { typ: 'rechteck', x: 1.5, y: 4.3, b: 3.6, h: 1.1, r: 0.4 },
      // Messer.
      { typ: 'polygon', punkte: [[8.0, 1.4], [9.6, 2.6], [9.6, 6.0], [8.0, 6.0]] },
      { typ: 'rechteck', x: 8.0, y: 5.4, b: 1.4, h: 5.2, r: 0.4 },
    ],
  },
  {
    id: 'poi-sehenswert',
    farbe: [0x8e, 0x24, 0xaa, 0xff], // Violett
    formen: [{ typ: 'stern', x: 6, y: 6.1, aussen: 5.2, innen: 2.1, zacken: 5 }],
  },
  {
    id: 'poi-versorgung',
    farbe: [0x02, 0x77, 0xbd, 0xff], // Wasserblau
    formen: [
      { typ: 'polygon', punkte: [[6, 1.1], [9.4, 6.6], [2.6, 6.6]] },
      { typ: 'kreis', x: 6, y: 7.0, r: 3.4 },
    ],
  },
];

/** Groesse einer POI-Marke in logischen Punkten. */
/**
 * Die Marken der VERKEHRSLAGE — Baustellen und Sperrungen.
 *
 * ─── WARUM EINE EIGENE LISTE ────────────────────────────────────────────────
 * Sie teilen sich Zeichenmaschinerie und Blatt mit den POIs, sind aber etwas
 * anderes: ein POI ist ein Ort, den man ansteuern kann; eine Baustelle ist
 * etwas, das einem entgegenkommt. Sie in `POI_MARKEN` zu legen hiesse, den
 * Namen jener Konstanten falsch werden zu lassen — und ein Name, der nicht
 * mehr stimmt, ist in diesem Projekt schon oefter teuer gewesen als die paar
 * Zeilen, die eine zweite Liste kostet.
 *
 * ─── DIE FORMEN ────────────────────────────────────────────────────────────
 * Beide muessen sich bei 18 Bildpunkten Durchmesser AUF DEN ERSTEN BLICK
 * unterscheiden -- und zwar waehrend der Fahrt. Deshalb nicht zwei Varianten
 * derselben Form, sondern zwei grundverschiedene: ein aufrechter Kegel gegen
 * einen liegenden Balken. Auch die Farben liegen weit auseinander.
 *
 * Gezeichnet wird weiss auf farbigem Kern. Ein `loch` laesst die Kernfarbe
 * durchscheinen -- beim Kegel ergibt das den Querstreifen, den man von
 * Leitkegeln kennt.
 */
export const VERKEHR_MARKEN = [
  {
    id: 'verkehr-baustelle',
    // Bernstein. Bewusst weit weg vom Rotorange des Wohnmobil-Stellplatzes:
    // die beiden duerfen aus dem Augenwinkel nicht dasselbe sein.
    farbe: [0xf2, 0xa0, 0x1e, 0xff],
    formen: [
      // ─── EIN KEGEL MIT FLACHER SPITZE, KEIN DREIECK ──────────────────
      // Zuerst stand hier ein spitzes Dreieck mit einem Querstreifen als
      // Loch. Angesehen sah man: der Streifen war an seiner Hoehe BREITER
      // als der Kegel und hat die Spitze abgetrennt -- uebrig blieben zwei
      // Bruchstuecke, die nichts mehr bedeuteten.
      //
      // Die flache Spitze loest beides auf einmal: sie macht den Kegel vom
      // gruenen Zelt-Dreieck unterscheidbar, auch wenn man die Farbe nicht
      // auswertet, und sie braucht keinen Streifen, der etwas durchschneiden
      // koennte.
      { typ: 'polygon', punkte: [[4.9, 1.5], [7.1, 1.5], [9.5, 8.9], [2.5, 8.9]] },
      // Die Standplatte. Sie macht aus einer Form, die steht, eine Form, die
      // AUFGESTELLT wurde.
      { typ: 'rechteck', x: 1.3, y: 9.2, b: 9.4, h: 1.6, r: 0.4 },
    ],
  },
  {
    id: 'verkehr-sperrung',
    // Rot. Die einzige Marke in diesem Satz, die „hier geht es nicht weiter"
    // sagt -- und die einzige in dieser Farbe.
    farbe: [0xc6, 0x28, 0x28, 0xff],
    formen: [
      // Ein einziger liegender Balken, wie im Verbotszeichen. Nichts sonst:
      // jede weitere Linie nimmt ihm bei dieser Groesse die Eindeutigkeit.
      // ─── HOCH GENUG, UM BEI 18 BILDPUNKTEN EIN BALKEN ZU SEIN ────────
      // Zuerst 2.0 Einheiten hoch. Bei einfacher Aufloesung sind das 1,4
      // Bildpunkte -- gerendert EINE Zeile, also ein Strich und kein Balken.
      // Gesehen hat man das erst im vergroesserten Abzug; gerechnet hatte es
      // vorher niemand.
      { typ: 'rechteck', x: 2.0, y: 4.4, b: 8.0, h: 3.2, r: 0.7 },
    ],
  },
];

/**
 * Die Marken der SONDERZIELE, die aus dem Suchindex kommen.
 *
 * ─── WARUM DIE NICHT BEI DEN ANDEREN POIS STEHEN ────────────────────────────
 * Weil sie aus einer anderen Quelle kommen, und das ist keine Feinheit. Alle
 * uebrigen POI-Marken werden aus dem `poi`-Layer der Kacheln gesetzt. Diese
 * beiden koennen dort nicht stehen: `sanitary_dump_station` und
 * `waste_disposal` kommen im OpenMapTiles-Schema nicht vor -- nachgezaehlt in
 * dessen `layers/poi/mapping.yaml`, beide 0x. Sie kommen aus
 * `lite_search-<region>.db`, wo sie schon immer lagen.
 *
 * Die Begruendung im Ganzen steht in
 * `apps/core/src/map/sonderziele/fehlendeKlassen.ts`.
 *
 * ─── DIE FORMEN ────────────────────────────────────────────────────────────
 * Beide muessen sich bei 18 Bildpunkten von der blauen Wassermarke
 * (`poi-versorgung`) unterscheiden lassen -- sie stehen oft nebeneinander, an
 * derselben Ver- und Entsorgungsstelle.
 *
 * Deshalb nicht noch ein Tropfen in einer anderen Farbe, sondern zwei andere
 * Grundformen: ein Pfeil, der nach UNTEN in eine Wanne zeigt (etwas wird
 * abgelassen), und eine Tonne mit Deckel. Richtung und Umriss tragen die
 * Bedeutung, nicht die Farbe.
 */
export const SONDERZIEL_MARKEN = [
  {
    id: 'poi-entsorgung',
    // Dunkles Petrol. Weit genug vom Wasserblau (0x0277bd) entfernt, um aus
    // dem Augenwinkel nicht dasselbe zu sein, und ohne mit dem Gruen des
    // Campingplatzes oder dem Rotorange des Stellplatzes zu konkurrieren.
    farbe: [0x00, 0x69, 0x5c, 0xff],
    formen: [
      // Pfeil nach unten: Schaft und Spitze. Sie ueberlappen um 0.4
      // Einheiten -- ohne diese Ueberlappung bleibt bei einfacher Aufloesung
      // eine helle Naht zwischen beiden stehen.
      { typ: 'rechteck', x: 5.0, y: 1.0, b: 2.0, h: 3.4, r: 0.3 },
      { typ: 'polygon', punkte: [[3.4, 4.0], [8.6, 4.0], [6, 7.4]] },
      // Die Wanne, in die abgelassen wird.
      //
      // Der Abstand zur Pfeilspitze ist 1.4 Einheiten und damit bei 18
      // Bildpunkten rund 2 Bildpunkte breit. Das ist Absicht: beim
      // Leitkegel war ein zu schmaler Zwischenraum genau der Fehler -- er
      // war nicht als Zwischenraum zu erkennen, sondern trennte die Form.
      { typ: 'polygon', punkte: [[2.4, 8.6], [9.6, 8.6], [8.6, 10.6], [3.4, 10.6]] },
    ],
  },
  {
    id: 'poi-frischwasser',
    // Helles Wasserblau. Bewusst ANDERS als das Petrol der Entsorgung: die
    // beiden stehen auf der Karte oft nebeneinander (derselbe Halt), und
    // genau dort muessen sie auf einen Blick auseinanderzuhalten sein.
    farbe: [0x02, 0x77, 0xbd, 0xff],
    // ─── ZWEI FORMEN, BEIDE GROSS ─────────────────────────────────────────
    // Der erste Entwurf hatte vier Teile (Rohr, Auslauf, Handrad, Radachse)
    // und war bei 18 Bildpunkten ein Krümelhaufen. Vergrössert angesehen
    // zerfiel er in unzusammenhängende Flecken -- dasselbe, was beim
    // Leitkegel und bei der Mülltonne schon schiefging.
    //
    // Die Marke ist 18 Punkte gross. Es passen ZWEI Formen hinein, nicht
    // vier. Also: ein Hahn (Rohr plus Auslauf als ein Winkel gelesen) und
    // ein Tropfen. Das Handrad ist gestrichen -- es war der Teil, der am
    // wenigsten trug und am meisten Platz nahm.
    formen: [
      // Der Hahn als kräftiger Winkel: waagerechtes Rohr, kurzer Auslauf.
      { typ: 'rechteck', x: 1.2, y: 1.0, b: 5.6, h: 2.2, r: 0.4 },
      // Der Auslauf muss deutlich UNTER dem Rohr enden, sonst ist der Winkel
      // keiner: im ersten Anlauf ragte er 0.6 Einheiten heraus und war bei
      // 18 Punkten schlicht nicht zu sehen.
      { typ: 'rechteck', x: 4.8, y: 1.0, b: 2.4, h: 4.0, r: 0.4 },
      // Der Tropfen: Spitze oben, Bauch unten. Der Abstand zum Auslauf ist
      // 1.6 Einheiten -- bei der Entsorgungsstation hat sich 1.4 als die
      // Grenze erwiesen, unterhalb derer ein Zwischenraum nicht mehr als
      // solcher gelesen wird, sondern die Form zerschneidet.
      { typ: 'polygon', punkte: [[6.0, 6.6], [8.6, 9.8], [3.4, 9.8]] },
      { typ: 'kreis', x: 6.0, y: 9.4, r: 2.5 },
    ],
  },
  {
    id: 'poi-dusche',
    // Dasselbe Blau wie die Zapfstelle -- beides ist Wasser, und ein
    // eigener Farbton fuer jede Kleinigkeit macht die Karte zum Farbkasten.
    // Unterschieden werden sie durch die FORM, nicht durch den Ton.
    farbe: [0x02, 0x77, 0xbd, 0xff],
    // Der erste Entwurf sass ganz im rechten Drittel und hatte fadenduenne
    // Strahlen -- vergroessert angesehen zerfiel der erste davon zu einem
    // Fleck. Jetzt sitzt die Form mittig und die Striche sind kraeftig
    // genug, um bei 18 Bildpunkten Striche zu bleiben.
    formen: [
      // Der Zulauf als Schraegstrich von links oben.
      { typ: 'polygon', punkte: [[1.4, 0.8], [3.0, 0.8], [7.6, 3.4], [6.6, 4.8]] },
      // Der Brausekopf: ein breiter Teller, mittig.
      { typ: 'polygon', punkte: [[2.6, 3.6], [11.0, 3.6], [9.8, 5.6], [3.8, 5.6]] },
      // Drei Strahlen. Unterschiedlich lang -- gleich lange Striche lesen
      // sich als Gitter, nicht als fallendes Wasser.
      { typ: 'rechteck', x: 4.0, y: 6.8, b: 1.3, h: 2.2, r: 0.5 },
      { typ: 'rechteck', x: 6.1, y: 6.8, b: 1.3, h: 3.6, r: 0.5 },
      { typ: 'rechteck', x: 8.2, y: 6.8, b: 1.3, h: 2.6, r: 0.5 },
    ],
  },
  {
    id: 'poi-muell',
    // Schiefergrau. Muell ist das Nebenziel dieser beiden; die Farbe soll
    // nicht um Aufmerksamkeit ruhen, die der Entsorgungsstation gehoert.
    farbe: [0x54, 0x6e, 0x7a, 0xff],
    formen: [
      { typ: 'rechteck', x: 5.0, y: 1.2, b: 2.0, h: 1.2, r: 0.3 }, // Griff
      { typ: 'rechteck', x: 2.2, y: 2.4, b: 7.6, h: 1.5, r: 0.4 }, // Deckel
      { typ: 'polygon', punkte: [[2.9, 4.2], [9.1, 4.2], [8.4, 10.5], [3.6, 10.5]] },
      // Zwei Rillen als Loch. Sie enden deutlich vor Boden und Deckel --
      // ein Loch, das eine Form durchschneidet, hinterlaesst Bruchstuecke
      // statt einer Tonne.
      { typ: 'rechteck', x: 4.6, y: 5.6, b: 1.0, h: 3.2, r: 0.2, loch: true },
      { typ: 'rechteck', x: 6.4, y: 5.6, b: 1.0, h: 3.2, r: 0.2, loch: true },
    ],
  },
];

/**
 * Alles, was als runde Marke auf das Blatt kommt.
 *
 * Eine Liste fuer das Layout, drei fuer die Bedeutung.
 */
export const ALLE_MARKEN = [...POI_MARKEN, ...VERKEHR_MARKEN, ...SONDERZIEL_MARKEN];

export const MARKE = { durchmesser: 18, ring: 1, feld: 12 };

/** Ein Stern als Polygon -- damit „Sehenswuerdigkeit" ohne Schriftzeichen
 *  auskommt. */
function sternPunkte(f) {
  const p = [];
  for (let i = 0; i < f.zacken * 2; i++) {
    const r = i % 2 === 0 ? f.aussen : f.innen;
    // Bei -90 Grad beginnen, damit die Spitze nach oben zeigt.
    const w = (Math.PI * i) / f.zacken - Math.PI / 2;
    p.push([f.x + r * Math.cos(w), f.y + r * Math.sin(w)]);
  }
  return p;
}

/** Punkt in Polygon, Kreuzungszahlregel. */
function imPolygon(x, y, punkte) {
  let drin = false;
  for (let i = 0, j = punkte.length - 1; i < punkte.length; j = i++) {
    const [xi, yi] = punkte[i];
    const [xj, yj] = punkte[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) drin = !drin;
  }
  return drin;
}

/** Deckt eine einzelne Form einen Punkt ab? */
function inForm(x, y, f) {
  if (f.typ === 'kreis') {
    const dx = x - f.x;
    const dy = y - f.y;
    return dx * dx + dy * dy <= f.r * f.r;
  }
  if (f.typ === 'rechteck') {
    return deckung(x, y, f.x, f.y, f.x + f.b, f.y + f.h, f.r ?? 0) > 0.5;
  }
  if (f.typ === 'stern') return imPolygon(x, y, sternPunkte(f));
  return imPolygon(x, y, f.punkte);
}

/**
 * Deckung eines Pixels durch eine Formenliste, 4x4 ueberabgetastet.
 *
 * `loch: true` SCHNEIDET aus, statt hinzuzufuegen -- so entstehen das Fenster
 * der Zapfsaeule, der Eingang des Zelts und der Bauch des „P", ohne dass es
 * dafuer eine zweite Farbe braeuchte.
 */
function formenDeckung(px, py, formen, ox, oy, skala) {
  const PROBEN = 4;
  let treffer = 0;
  for (let sy = 0; sy < PROBEN; sy++) {
    for (let sx = 0; sx < PROBEN; sx++) {
      // Zurueck ins 12x12-Feld rechnen.
      const x = (px + (sx + 0.5) / PROBEN - ox) / skala;
      const y = (py + (sy + 0.5) / PROBEN - oy) / skala;
      let drin = false;
      for (const f of formen) {
        if (inForm(x, y, f)) drin = f.loch ? false : true;
      }
      if (drin) treffer++;
    }
  }
  return treffer / (PROBEN * PROBEN);
}

/** Zeichnet eine POI-Marke: weisse Scheibe, farbiger Kern, weisses Symbol. */
export function zeichneMarke(puffer, blattBreite, ox, oy, marke, skala) {
  const d = MARKE.durchmesser * skala;
  const mitte = d / 2;
  const aussenR = d / 2;
  const kernR = aussenR - MARKE.ring * skala;
  // Das 12x12-Feld sitzt mittig auf der Scheibe.
  const feldSkala = (MARKE.feld / MARKE.durchmesser) * skala * 1.05;
  const feldOx = mitte - (MARKE.feld / 2) * feldSkala;
  const feldOy = mitte - (MARKE.feld / 2) * feldSkala;

  for (let y = 0; y < d; y++) {
    for (let x = 0; x < d; x++) {
      const scheibe = deckung(x, y, 0, 0, d, d, aussenR);
      if (scheibe <= 0) continue;
      const kern = deckung(x, y, MARKE.ring * skala, MARKE.ring * skala, d - MARKE.ring * skala, d - MARKE.ring * skala, kernR);
      const symbol = formenDeckung(x, y, marke.formen, feldOx, feldOy, feldSkala);

      const i = ((oy + y) * blattBreite + (ox + x)) * 4;
      // Weisse Scheibe, farbiger Kern darauf, weisses Symbol obendrauf.
      for (let k = 0; k < 3; k++) puffer[i + k] = mischen(puffer[i + k], 0xff, scheibe);
      puffer[i + 3] = mischen(puffer[i + 3], 255, scheibe);
      for (let k = 0; k < 3; k++) puffer[i + k] = mischen(puffer[i + k], marke.farbe[k], kern);
      for (let k = 0; k < 3; k++) puffer[i + k] = mischen(puffer[i + k], 0xff, symbol);
    }
  }
}

// ────────────────────────────── Das Blatt ───────────────────────────────────

/**
 * Abstand zwischen den Symbolen, damit beim Skalieren nichts überläuft.
 *
 * Wird MITSKALIERT. Zuerst war er eine feste Zahl — dann ist das @2x-Blatt
 * aber nicht mehr dieselbe Form in fein, sondern eine minimal andere. Die
 * Prüfung „bei doppelter Auflösung verdoppeln sich auch die Maße" hat genau
 * das gefunden.
 */
const LUECKE = 2;

/** Der Abstand in Bildpunkten für ein Pixelverhältnis. */
function luecke(skala) {
  return Math.round(LUECKE * skala);
}

/** Erzeugt Blatt und Beschreibung für ein Pixelverhältnis. */
export function baueBlatt(skala) {
  const b = Math.round(MASSE.breite * skala);
  const h = Math.round(MASSE.hoehe * skala);
  const d = Math.round(MARKE.durchmesser * skala);

  // Eine Zeile Schilder, darunter eine Zeile Marken. Zwei Zeilen statt einer
  // langen, damit das Blatt nicht unnoetig breit wird -- manche Grafikkarten
  // begrenzen die Texturbreite.
  const l = luecke(skala);
  const schilderBreite = SHIELDS.length * b + (SHIELDS.length - 1) * l;
  const markenBreite = ALLE_MARKEN.length * d + (ALLE_MARKEN.length - 1) * l;
  const blattBreite = Math.max(schilderBreite, markenBreite);
  const hoehe = h + l + d;
  const puffer = Buffer.alloc(blattBreite * hoehe * 4, 0);

  const bereiche = dehnbereiche(skala);
  const beschreibung = {};

  SHIELDS.forEach((schild, n) => {
    const ox = n * (b + l);
    zeichneSchild(puffer, blattBreite, ox, 0, schild, skala);
    beschreibung[schild.id] = { x: ox, y: 0, width: b, height: h, pixelRatio: skala, ...bereiche };
  });

  ALLE_MARKEN.forEach((marke, n) => {
    const ox = n * (d + l);
    const oy = h + l;
    zeichneMarke(puffer, blattBreite, ox, oy, marke, skala);
    // KEINE Dehnbereiche: eine Marke traegt keinen Text, sie soll rund
    // bleiben. `icon-text-fit` fasst sie damit gar nicht erst an.
    beschreibung[marke.id] = { x: ox, y: oy, width: d, height: d, pixelRatio: skala };
  });

  return { png: alsPng(puffer, blattBreite, hoehe), beschreibung, blattBreite, hoehe };
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
  // Ein Werkzeug, kein Dienst -- Ausgabe auf der Konsole ist hier der Zweck.
  console.log(`Schilder geschrieben nach ${OUT_DIR}`);
}

if (process.argv[1] && process.argv[1].endsWith('generate-sprites.mjs')) {
  main();
}
