/**
 * Was ein Routingbau dazugewinnt — und was er verliert.
 *
 * ─── DER GEMELDETE FALL ─────────────────────────────────────────────────────
 * „Das routing funktioniert nicht mehr. Es erscheint eine Fehlermeldung
 * ‚no edges found near location'. Liegt das daran dass nur das routing für
 * Liechtenstein angezeigt wird?"
 *
 * Ja, genau daran. Und es war kein Bedienfehler.
 *
 * ─── WARUM DAS PASSIEREN KONNTE ─────────────────────────────────────────────
 * Es gibt EINEN Routinggraphen, nicht einen je Region. Seit 0.4.0 baut
 * `yapaja-build-graph` ihn über JEDE `.osm.pbf`, die im Zwischenlager liegt —
 * das sollte „alles, was installiert ist" bedeuten.
 *
 * Tut es aber nicht. Der KACHELBAU lädt seinen OSM-Extrakt in ein temporäres
 * Verzeichnis und löscht es am Ende wieder (`build-pmtiles.sh`: `WORK_DIR`,
 * `trap cleanup EXIT`). Im Zwischenlager landen nur die gemeinsamen
 * Basisdaten — das Skript sagt es sogar selbst: „Dauerhafte Ablage der NICHT
 * regionsspezifischen Basisdaten".
 *
 * Ein Extrakt liegt dort also NUR, wenn für diese Region schon einmal
 * „Routing bauen" gedrückt wurde. Eine installierte Karte heißt nicht, dass
 * es dafür auch Straßendaten gibt.
 *
 * Folge: Wer drei Länder installiert und dann „Routing bauen" bei dem
 * kleinsten drückt, hat danach Routing NUR für das kleinste — und die
 * Oberfläche legt mit einem Knopf je Region das Gegenteil nahe. In Köln
 * antwortet Valhalla dann mit „No suitable edges near location", und nichts
 * verbindet diese Meldung mit dem Knopf von vorhin.
 *
 * ─── WAS DIESE DATEI TUT ────────────────────────────────────────────────────
 * Sie rechnet VOR dem Bau aus, was danach im Graphen liegt und was nicht. Der
 * Bau kann damit fragen, statt hinterher zu überraschen. Sie baut nichts und
 * löscht nichts — sie sieht nur nach.
 */

import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

/** Endung der OSM-Extrakte im Zwischenlager. */
const PBF_SUFFIX = '.osm.pbf';

/**
 * Das Zwischenlager der OSM-Extrakte.
 *
 * Abgeleitet wie in `yapaja-build-graph`: zwei Ebenen über dem
 * Graphverzeichnis, dann `planetiler-sources`. Stünde der Pfad hier frei
 * daneben, könnten Skript und Kern auf verschiedene Ordner sehen — und der
 * Kern meldete beruhigt eine Abdeckung, die der Bau nie herstellt.
 */
export function pbfLagerPfad(graphDir: string): string {
  return join(dirname(dirname(graphDir)), 'planetiler-sources');
}

/**
 * Welche Regionen im Zwischenlager einen Extrakt haben.
 *
 * Wirft nie: ein fehlender Ordner heißt „noch nichts gebaut", und das ist ein
 * normaler Zustand.
 */
export function regionenMitExtrakt(lagerPfad: string): string[] {
  let eintraege: string[];
  try {
    eintraege = readdirSync(lagerPfad);
  } catch {
    return [];
  }
  return eintraege
    .filter((name) => name.endsWith(PBF_SUFFIX))
    .map((name) => name.slice(0, -PBF_SUFFIX.length))
    .sort();
}

export interface GraphAbdeckung {
  /** Was nach dem Bau im Graphen liegt. */
  danach: string[];
  /** Installierte Karten, für die es danach KEIN Routing gibt. */
  ohneRouting: string[];
  /** Was der Bau gegenüber dem jetzigen Graphen verliert. */
  verliert: string[];
}

/**
 * Rechnet aus, wie der Graph nach einem Bau aussieht.
 *
 * `bauRegion` kommt dazu, weil der Bau ihren Extrakt selbst herunterlädt,
 * bevor er sammelt — sie ist also danach in jedem Fall dabei.
 */
export function abdeckungNachBau(args: {
  /** Regionen, deren Karte installiert ist. */
  installiert: readonly string[];
  /** Regionen, die schon einen Extrakt im Zwischenlager haben. */
  mitExtrakt: readonly string[];
  /** Die Region, für die gerade gebaut wird. */
  bauRegion: string;
  /** Was IM MOMENT im Graphen liegt (aus `build-info.json`). */
  jetzt?: readonly string[];
}): GraphAbdeckung {
  const danach = [...new Set([...args.mitExtrakt, args.bauRegion])].sort();
  const danachSet = new Set(danach);
  return {
    danach,
    ohneRouting: [...args.installiert].filter((r) => !danachSet.has(r)).sort(),
    verliert: [...(args.jetzt ?? [])].filter((r) => !danachSet.has(r)).sort(),
  };
}

/**
 * Der Satz, der dem Betreiber gesagt wird.
 *
 * Er nennt BEIDE Richtungen — was dazukommt und was fehlt. „Es wird gebaut"
 * allein wäre genau die Auskunft, die hier gefehlt hat.
 */
export function abdeckungSatz(a: GraphAbdeckung): string {
  const teile = [`Der neue Routinggraph enthält: ${a.danach.join(', ')}.`];
  if (a.verliert.length > 0) {
    teile.push(
      `Verloren geht das Routing für: ${a.verliert.join(', ')} — es ist derzeit im Graphen, ` +
        'aber es liegt kein OSM-Extrakt mehr dafür bereit.',
    );
  }
  if (a.ohneRouting.length > 0) {
    teile.push(
      `Ohne Routing bleiben diese installierten Karten: ${a.ohneRouting.join(', ')}. ` +
        'Eine installierte Karte enthält keine Straßendaten für die Routenberechnung — ' +
        'dafür muss für jede Region einmal „Routing bauen" gedrückt werden. Der Graph ' +
        'sammelt danach alles ein, was schon da ist.',
    );
  }
  if (a.verliert.length === 0 && a.ohneRouting.length === 0) {
    teile.push('Alle installierten Karten sind damit abgedeckt.');
  }
  return teile.join(' ');
}

/**
 * Welche Regionen IM MOMENT im Graphen liegen.
 *
 * Aus derselben `build-info.json`, aus der auch die Übersicht „Was ist
 * gebaut?" liest — damit Warnung und Anzeige nicht auseinanderlaufen können.
 * Wirft nie: kein Graph ist ein normaler Zustand.
 */
export function graphRegionenJetzt(graphDir: string): string[] {
  try {
    const roh: unknown = JSON.parse(
      readFileSync(join(dirname(graphDir), 'build-info.json'), 'utf8'),
    );
    if (!roh || typeof roh !== 'object') return [];
    const obj = roh as Record<string, unknown>;
    if (Array.isArray(obj.regions)) {
      return obj.regions.filter((r): r is string => typeof r === 'string').sort();
    }
    // Ein Graph von vor 0.4.0 kennt nur EINE Region.
    return typeof obj.region === 'string' ? [obj.region] : [];
  } catch {
    return [];
  }
}
