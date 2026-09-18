/**
 * EINE Liste aller Karten — installierte und verfügbare zusammen.
 *
 * ─── WOFÜR ──────────────────────────────────────────────────────────────────
 * Gewünscht:
 *
 *   „Das bedeutet der Anwender klickt bei einer Karte nur noch auf
 *    ‚installieren' (sofern nicht installiert), ‚Update' (bei installierten
 *    Karten zum Update) oder ‚löschen' falls bereits installiert."
 *
 * Bis 0.15.3 gab es ZWEI Listen, „Installierte Regionen" und „Verfügbare
 * Regionen", und an jedem Eintrag bis zu vier Knöpfe: Herunterladen bzw.
 * Kacheln bauen, Routing bauen, Suche bauen, Löschen.
 *
 * Das legte eine Frage nahe, die niemand stellen will. „Routing bauen" und
 * „Suche bauen" sind Erzeugnisse, keine Handlungen — wer eine Karte
 * installiert, will danach nicht wissen, welche Nebenprodukte es gibt,
 * sondern dass alles wieder passt. Dafür gibt es jetzt den einen Knopf
 * (`POST /api/v1/map/gesamtbau`), und hier bleiben genau drei Handlungen.
 *
 * Eine Karte wanderte ausserdem beim Installieren von der einen Liste in die
 * andere und wechselte dabei die Knöpfe. Wer sie in der oberen suchte, fand
 * sie nicht mehr — dieselbe Karte, zwei Plätze.
 *
 * ─── WARUM DAS HIER STEHT UND NICHT IN DER KOMPONENTE ───────────────────────
 * Weil es eine Entscheidung ist und keine Darstellung: welcher Zustand eine
 * Karte hat und was man mit ihr tun kann. In einem React-Baustein wäre das
 * nur noch im Browser zu erreichen — und genau so ist 0.9.1 unbemerkt
 * wirkungslos geworden.
 */

import type { CatalogRegion, InstalledRegion } from './client';

/**
 * In welchem Zustand eine Karte ist.
 *
 * `fremd` ist der Fall, den die zwei alten Listen gar nicht kannten: eine von
 * Hand nach `/share` gelegte `.pmtiles`, die in keinem Katalog steht. Sie ist
 * installiert und wird gezeichnet, aber für sie lässt sich nichts bauen —
 * es gibt keine OSM-Quelle. Das zu verschweigen wäre die schlimmere Antwort:
 * der Gesamtbau überspringt sie, und wer nicht weiss warum, sucht den Fehler
 * woanders.
 */
export type Kartenzustand = 'installiert' | 'fremd' | 'verfuegbar' | 'ohne_quelle';

/** Wie eine Karte an ihre Kacheln kommt. */
export type Kartenquelle =
  /** Fertige `.pmtiles` zum Herunterladen — Minuten. */
  | 'download'
  /** Aus dem OSM-Extrakt bauen — Stunden bei einem grossen Land. */
  | 'bau'
  /** Gar nicht (weder Datei noch Extrakt hinterlegt). */
  | null;

export interface Karteneintrag {
  id: string;
  /** Der Name aus dem Katalog; bei einer fremden Karte ihr Dateiname. */
  name: string;
  zustand: Kartenzustand;
  /** Die tatsächliche Grösse bei installierten, die erwartete sonst. */
  groesseBytes: number;
  bounds: [number, number, number, number] | null;
  quelle: Kartenquelle;
  /** Aufwandshinweis aus dem Katalog. */
  grosserBau: boolean;
  /** Freitext aus dem Katalog. */
  hinweis?: string;
}

/** Ist diese Karte installiert? */
export function istInstalliert(eintrag: Karteneintrag): boolean {
  return eintrag.zustand === 'installiert' || eintrag.zustand === 'fremd';
}

/**
 * Kann man diese Karte installieren oder aktualisieren?
 *
 * Beides ist dieselbe Handlung — der Kachelbau ersetzt, was da ist. Ein
 * Knopf, der nicht funktionieren KANN, ist schlimmer als kein Knopf: er
 * schickt den Betreiber auf die Fehlersuche in seiner eigenen Installation.
 * Deshalb hängt das an der Quelle und nicht am Zustand.
 */
export function kannInstallieren(eintrag: Karteneintrag): boolean {
  return eintrag.quelle !== null;
}

function quelleVon(eintrag: CatalogRegion): Kartenquelle {
  if (eintrag.url) return 'download';
  if (eintrag.pbfUrl) return 'bau';
  return null;
}

/**
 * Alle Karten, alphabetisch — installierte zuerst.
 *
 * ─── WARUM INSTALLIERTE ZUERST ──────────────────────────────────────────────
 * Sie sind das, was der Betreiber besitzt und wovon er etwas sieht. Der
 * Katalog ist ein Angebot. Eine rein alphabetische Liste über alles hinweg
 * liesse die eigenen Karten zwischen Dutzenden fremder Ländernamen
 * verschwinden.
 */
export function kartenliste(
  installiert: readonly InstalledRegion[],
  katalog: readonly CatalogRegion[],
): Karteneintrag[] {
  const katalogNach = new Map(katalog.map((e) => [e.id, e]));
  const eintraege: Karteneintrag[] = [];

  for (const karte of installiert) {
    const aus = katalogNach.get(karte.region);
    eintraege.push({
      id: karte.region,
      name: aus?.name ?? karte.region,
      // Ohne Katalogeintrag gibt es keine Quelle -- also auch kein Update.
      zustand: aus ? 'installiert' : 'fremd',
      // Die TATSAECHLICHE Groesse, nicht die erwartete: bei einer
      // installierten Karte ist das, was auf der Platte liegt, die
      // interessantere Zahl.
      groesseBytes: karte.size_bytes,
      bounds: karte.bounds,
      quelle: aus ? quelleVon(aus) : null,
      grosserBau: aus?.buildEffort === 'large',
      ...(aus?.note ? { hinweis: aus.note } : {}),
    });
  }

  for (const eintrag of katalog) {
    // `installed` kommt vom Kern; die Liste oben ist die Gegenprobe. Beide
    // zu pruefen kostet nichts und faengt den Fall ab, dass eine Karte
    // zweimal erscheint -- einmal als installiert, einmal als Angebot.
    if (eintrag.installed) continue;
    if (installiert.some((k) => k.region === eintrag.id)) continue;
    const quelle = quelleVon(eintrag);
    eintraege.push({
      id: eintrag.id,
      name: eintrag.name,
      zustand: quelle === null ? 'ohne_quelle' : 'verfuegbar',
      groesseBytes: eintrag.sizeBytes,
      bounds: eintrag.bounds,
      quelle,
      grosserBau: eintrag.buildEffort === 'large',
      ...(eintrag.note ? { hinweis: eintrag.note } : {}),
    });
  }

  return eintraege.sort((a, b) => {
    const aInstalliert = istInstalliert(a);
    const bInstalliert = istInstalliert(b);
    if (aInstalliert !== bInstalliert) return aInstalliert ? -1 : 1;
    return a.name.localeCompare(b.name, 'de');
  });
}

/** Die Beschriftung des einen Knopfes, der installiert oder aktualisiert. */
export function installierenText(eintrag: Karteneintrag): string {
  return istInstalliert(eintrag) ? 'Update' : 'Installieren';
}
