/**
 * Die gemessenen Baudauern auf der Platte.
 *
 * ─── WARUM DAS VON `bauzeit.ts` GETRENNT IST ────────────────────────────────
 * Dort stehen die Regeln, hier steht die Platte. Dieselbe Trennung wie bei
 * `tempolimitHier.ts` / `tempolimitDienst.ts`: die Regeln sind ohne
 * Dateisystem prüfbar, und was hier liegt, ist der Rest.
 *
 * ─── WARUM ES ÜBERHAUPT AUF DIE PLATTE MUSS ─────────────────────────────────
 * Ein Erfahrungswert, der im Speicher des Add-ons liegt, ist nach dem
 * nächsten Neustart weg — und damit genau dann, wenn jemand ihn braucht: beim
 * ZWEITEN Bau, Wochen nach dem ersten. Ein Bau über Deutschland dauert
 * Stunden; die Messung davon ist zu teuer, um sie wegzuwerfen.
 *
 * ─── WAS HIER BEWUSST NICHT PASSIERT ────────────────────────────────────────
 * Kein Mitteln über mehrere Läufe, kein gleitender Durchschnitt. Es zählt der
 * LETZTE Lauf. Das Gerät, die Kartenmenge und die Werkzeugversionen ändern
 * sich über die Zeit; ein Mittelwert aus zwei Jahren beschreibt dann keinen
 * der beiden Zustände. Der letzte Lauf ist die einzige Messung, von der man
 * sicher weiss, unter welchen Bedingungen sie entstand.
 *
 * Und: diese Datei ist NIE wichtig. Geht sie verloren, ist sie kaputt oder
 * löscht sie jemand von Hand, fehlt danach nur die Restzeitangabe. Deshalb
 * wirft hier nichts — ein Bau darf nicht daran scheitern, dass eine
 * Komfortangabe nicht zu schreiben war.
 */

import { readFileSync, writeFileSync, renameSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type { Bauerfahrung } from './bauzeit.js';

/** Wo die Messwerte liegen — neben `build-info.json`, also im Datenwurzel-
 *  verzeichnis und nicht im Kachelverzeichnis: sie gehören zu keiner
 *  einzelnen Karte. */
export function bauzeitenPfad(tilesDir: string): string {
  return join(dirname(tilesDir), 'bauzeiten.json');
}

/**
 * Wie lange ein Wert höchstens gilt.
 *
 * Nach einem halben Jahr hat sich meist etwas geändert, das die Dauer
 * beeinflusst — eine neue Add-on-Version mit anderem planetiler, ein anderes
 * Gerät, gewachsene OSM-Daten. Ein Wert von damals ist dann keine Messung
 * mehr, sondern eine Erinnerung. „Keine Angabe" ist ehrlicher.
 */
export const HOECHSTALTER_MS = 180 * 24 * 60 * 60 * 1000;

interface Eintrag {
  sekunden: number;
  gemessenAm: string;
}

type Datei = Record<string, Eintrag>;

/** Liest die Datei. Wirft nie; alles Unlesbare ist schlicht „nichts". */
function leseDatei(pfad: string): Datei {
  let roh: string;
  try {
    roh = readFileSync(pfad, 'utf8');
  } catch {
    // Kein Fehler: eine frische Installation hat noch nie gebaut.
    return {};
  }
  try {
    const geparst: unknown = JSON.parse(roh);
    if (!geparst || typeof geparst !== 'object' || Array.isArray(geparst)) return {};
    return geparst as Datei;
  } catch {
    // Eine halb geschriebene oder von Hand verhunzte Datei darf nicht dazu
    // führen, dass gar nichts mehr geht.
    return {};
  }
}

/**
 * Die brauchbaren Messwerte.
 *
 * Aussortiert wird, was nicht zu gebrauchen ist: kaputte Einträge und zu
 * alte. Beides ergibt „kein Wert", und `bauzeit.ts` macht daraus dann
 * „mindestens" oder „unbekannt" — statt mit einer unsinnigen Zahl zu rechnen.
 */
export function leseErfahrung(pfad: string, jetzt: number = Date.now()): Bauerfahrung {
  const datei = leseDatei(pfad);
  const raus: Bauerfahrung = {};
  for (const [schluessel, eintrag] of Object.entries(datei)) {
    if (!eintrag || typeof eintrag !== 'object') continue;
    const { sekunden, gemessenAm } = eintrag;
    if (typeof sekunden !== 'number' || !Number.isFinite(sekunden) || sekunden <= 0) continue;
    if (typeof gemessenAm !== 'string') continue;
    const gemessen = Date.parse(gemessenAm);
    // Ein unlesbarer Zeitstempel macht den Wert unbrauchbar: ohne ihn lässt
    // sich das Höchstalter nicht prüfen, und ungeprüft durchzulassen hiesse,
    // die Regel abzuschaffen.
    if (!Number.isFinite(gemessen)) continue;
    if (jetzt - gemessen > HOECHSTALTER_MS) continue;
    raus[schluessel] = sekunden;
  }
  return raus;
}

/**
 * Merkt sich eine gemessene Dauer.
 *
 * Geschrieben wird über eine temporäre Datei und `rename`, wie überall sonst
 * in diesem Projekt auch: ein Absturz mitten im Schreiben darf keine halbe
 * JSON-Datei hinterlassen. Sie wäre zwar folgenlos (siehe `leseDatei`), aber
 * eine kaputte Datei auf der Platte ist etwas, das jemand irgendwann findet
 * und für die Ursache von etwas anderem hält.
 *
 * Wirft nie.
 */
export function merkeDauer(
  pfad: string,
  schluessel: string,
  sekunden: number,
  jetzt: number = Date.now(),
): void {
  if (!Number.isFinite(sekunden) || sekunden <= 0) return;
  const datei = leseDatei(pfad);
  datei[schluessel] = { sekunden: Math.round(sekunden), gemessenAm: new Date(jetzt).toISOString() };
  const temp = `${pfad}.tmp-${process.pid}`;
  try {
    mkdirSync(dirname(pfad), { recursive: true });
    writeFileSync(temp, `${JSON.stringify(datei, null, 2)}\n`, 'utf8');
    renameSync(temp, pfad);
  } catch {
    // Eine nicht schreibbare Komfortangabe ist kein Grund, irgendetwas
    // abzubrechen. Beim nächsten Bau fehlt dann eben die Restzeit.
  }
}
