/**
 * Woraus der Routinggraph gebaut wird — und was dafür noch fehlt.
 *
 * ─── DIE ENTSCHEIDUNG, DIE HIER STECKT ──────────────────────────────────────
 * „Du kannst das routing über alle installierten Karten laufen lassen."
 *
 * Bis 0.10.1 hieß „Routing bauen" bei germany: baue über das, was zufällig im
 * Zwischenlager liegt. Das war eine Abdeckung, die niemand gewählt hatte —
 * sie ergab sich daraus, für welche Region zuletzt gebaut worden war. 0.10.1
 * hat diesen Zufall wenigstens SICHTBAR gemacht (`graphAbdeckung.ts`), aber
 * beseitigt hat er ihn nicht: der Betreiber bekam eine Warnung und keinen Weg.
 *
 * Ab hier ist die Abdeckung eine Ansage: **jede installierte Karte kommt in
 * den Graphen.** Fehlt für eine der OSM-Extrakt, wird er geladen, statt sie
 * stillschweigend draußen zu lassen.
 *
 * ─── WARUM DIESE RECHNUNG NICHT IM SKRIPT STEHT ─────────────────────────────
 * Das Skript sieht nur das Zwischenlager. Welche Karten INSTALLIERT sind und
 * wo ihr Extrakt herkäme, weiß allein der Kern — er hält den Katalog. Genau
 * an dieser Nahtstelle ist der gemeldete Fehler entstanden: zwei Seiten, von
 * denen jede nur die Hälfte sah, und keine hat es gemerkt.
 *
 * ─── EINE EIGENSCHAFT, DIE HIER GELTEN MUSS ─────────────────────────────────
 * Der Plan darf NIE eine Region verlieren, die schon im Graphen liegt. Das
 * war der Fehler („no edges found near location" mitten in Deutschland), und
 * `graphPlan.test.ts` hält ihn als Eigenschaft fest, nicht als Einzelfall.
 */

/** Was der Katalog über eine Region weiß, soweit es hier zählt. */
export interface KatalogQuelle {
  id: string;
  pbfUrl?: string | null;
}

export interface ZuLaden {
  region: string;
  url: string;
}

export interface GraphBauPlan {
  /** Die Regionen, über die der Graph gebaut wird — sortiert. */
  regionen: string[];
  /** Extrakte, die dafür noch geladen werden müssen. */
  zuLaden: ZuLaden[];
  /**
   * Installierte Karten, die draußen bleiben, weil es für sie weder einen
   * Extrakt noch eine brauchbare Quelle gibt. Sie werden GENANNT und nicht
   * weggelassen — eine fehlende Region ist beim Routen sonst nicht von einem
   * Fehler zu unterscheiden.
   */
  ohneQuelle: string[];
}

/**
 * Eine Quelle, die sich nicht gefahrlos an ein Skript weiterreichen lässt,
 * ist keine Quelle.
 *
 * Der Plan geht als Zeilen „<region> <url>" an `yapaja-build-graph`. Eine URL
 * mit Leerraum darin würde dort in zwei Felder zerfallen — das Ergebnis wäre
 * ein Download, der auf einen abgeschnittenen Pfad zielt, und eine Region,
 * die lautlos fehlt. Lieber hier als unbrauchbar melden.
 */
function quelleBrauchbar(url: string | null | undefined): url is string {
  return typeof url === 'string' && url.length > 0 && !/\s/.test(url);
}

/**
 * Rechnet aus, worüber gebaut wird.
 *
 * `bauRegion` ist die Region, deren Knopf gedrückt wurde. Sie ist nur noch
 * eine von vielen — der Graph ist einer für alle. Der Knopf bleibt trotzdem
 * je Region stehen, weil er dort steht, wo der Betreiber hinsieht; was er
 * auslöst, sagt jetzt die Abdeckung daneben.
 */
export function graphBauPlan(args: {
  /** Regionen, deren Karte installiert ist. */
  installiert: readonly string[];
  /** Regionen, die schon einen Extrakt im Zwischenlager haben. */
  mitExtrakt: readonly string[];
  /** Der Regionen-Katalog — er liefert die `pbfUrl`. */
  katalog: readonly KatalogQuelle[];
  /** Die Region, deren Knopf gedrückt wurde. */
  bauRegion: string;
}): GraphBauPlan {
  const quellen = new Map<string, string>();
  for (const eintrag of args.katalog) {
    if (quelleBrauchbar(eintrag.pbfUrl)) {
      quellen.set(eintrag.id, eintrag.pbfUrl);
    }
  }

  const vorhanden = new Set(args.mitExtrakt);

  // Alle drei Mengen zusammen, und das ist Absicht:
  //   * `installiert`  — was der Betreiber sieht und erwartet;
  //   * `mitExtrakt`   — was das Skript ohnehin einsammelt (es liest das
  //                      Zwischenlager per Glob). Stünde es hier nicht drin,
  //                      würde der Plan etwas anderes behaupten als der Bau
  //                      tut — und zwar in der gefährlichen Richtung: er
  //                      verspräche WENIGER, als am Ende drin ist, und die
  //                      Warnung „geht verloren" wäre falscher Alarm.
  //   * `bauRegion`    — der gedrückte Knopf.
  const ziel = [...new Set([...args.installiert, ...args.mitExtrakt, args.bauRegion])].sort();

  const regionen: string[] = [];
  const zuLaden: ZuLaden[] = [];
  const ohneQuelle: string[] = [];

  for (const region of ziel) {
    if (vorhanden.has(region)) {
      regionen.push(region);
      continue;
    }
    const url = quellen.get(region);
    if (url === undefined) {
      ohneQuelle.push(region);
      continue;
    }
    regionen.push(region);
    zuLaden.push({ region, url });
  }

  return { regionen, zuLaden, ohneQuelle };
}

/**
 * Der Plan in der Form, in der `yapaja-build-graph` ihn liest: eine Zeile je
 * nachzuladendem Extrakt, `<region> <url>`.
 *
 * Eine Umgebungsvariable und keine Datei, weil der Bau ohnehin über
 * `spawn(command, args, env)` startet — eine Datei bräuchte einen Pfad, eine
 * Aufräumregel und einen Fall „Datei war von gestern".
 */
export function planAlsEnv(plan: GraphBauPlan): string {
  return plan.zuLaden.map(({ region, url }) => `${region} ${url}`).join('\n');
}

/** Der Name jener Variablen — an einer Stelle, damit Kern und Skript nicht
 *  auseinanderlaufen können. */
export const GRAPH_PLAN_ENV = 'YAPAIA_GRAPH_EXTRAKTE';
