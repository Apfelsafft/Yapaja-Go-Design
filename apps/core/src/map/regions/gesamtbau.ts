/**
 * Ein Knopf, der alles wieder zusammenbaut.
 *
 * ─── WOFÜR ──────────────────────────────────────────────────────────────────
 * Gewünscht: „Dann gibt es noch einen gemeinsamen Knopf der nach einer neuen
 * Installation oder Update alles wieder neu baut für eine gemeinsame
 * Anzeige."
 *
 * Bis 0.15.3 standen an jeder Karte drei Bau-Knöpfe — „Routing bauen",
 * „Suche bauen", und im Katalog noch „Kacheln bauen". Für jemanden, der
 * gerade eine Karte installiert hat, ist das die falsche Frage: er will nicht
 * wissen, WELCHE Erzeugnisse es gibt, sondern dass danach alles wieder passt.
 *
 * ─── WAS IN WELCHER REIHENFOLGE ─────────────────────────────────────────────
 * Die Kacheln sind die Installation selbst und stehen deshalb NICHT in diesem
 * Ablauf. Was nach einer Installation nachgezogen werden muss, ist:
 *
 *   1. der Routinggraph — EINMAL, er deckt seit 0.10.2 alle Karten ab;
 *   2. der Suchindex — je Karte einer (`lite_search-<region>.db`).
 *
 * Das Routing zuerst, weil es das ist, wovon das Fahren abhängt: bricht der
 * Lauf danach ab, hat man wenigstens eine fahrbare Installation ohne
 * Adresssuche — und nicht umgekehrt.
 *
 * ─── EIN JOB, MEHRERE LÄUFE ─────────────────────────────────────────────────
 * Alle Schritte laufen in EINEM Job. Das ist keine Sparsamkeit, sondern die
 * Bedingung dafür, dass die Oberfläche nach einem Seitenwechsel wieder
 * andocken kann (`findUnfinished` / `laufender-bau`): eine Kette aus fünf
 * Jobs wäre von aussen nicht als ein Vorgang zu erkennen.
 *
 * Und es ist dieselbe Sperre wie bisher (`BUILD_JOB_KIND`): es läuft immer
 * höchstens ein schwerer Bau, sonst treffen sich zwei planetiler-Prozesse im
 * selben Quellenverzeichnis oder zwei Läufe im OOM-Killer.
 */

import type { CatalogEntry } from './catalog.js';
import type { JobRegistry, Gesamtstand } from './jobs.js';
import {
  ABBRUCH_MELDUNG,
  GRAPH_BUILD,
  LITE_INDEX_BUILD,
  laufeBau,
  type BuildJobDeps,
  type BuildVariant,
} from './build.js';
import {
  restdauer,
  restText,
  schluessel,
  type Bauerfahrung,
  type Bauschritt,
} from './bauzeit.js';
import { leseErfahrung, merkeDauer } from './bauzeitSpeicher.js';

/**
 * Der Ablauf für eine Menge installierter Karten.
 *
 * Rein und ohne Seiteneffekte, damit die Reihenfolge prüfbar ist, ohne
 * irgendetwas zu bauen.
 *
 * Ohne installierte Karte gibt es NICHTS zu bauen — und zwar wirklich nichts,
 * nicht „einen Routinggraphen über nichts". Der Aufrufer lehnt diesen Fall
 * ab, statt einen leeren Lauf zu starten, der nach zwei Sekunden „fertig"
 * meldet und nichts getan hat.
 */
export function gesamtplan(regionen: readonly string[]): Bauschritt[] {
  if (regionen.length === 0) return [];
  const sortiert = [...regionen].sort();
  return [
    // Die Region am Routingschritt ist nur ein Etikett: gebaut wird über
    // alle. Genommen wird die alphabetisch erste, damit derselbe Bestand
    // immer denselben Plan ergibt.
    { bauart: 'routing', region: sortiert[0] },
    ...sortiert.map((region): Bauschritt => ({ bauart: 'suche', region })),
  ];
}

/**
 * Was gebaut IST — soweit es für die Frage „was fehlt noch?" zählt.
 * Kommt aus `buildStatus.ts#collectBuildStatus`.
 */
export interface Baubestand {
  /** Regionen im Routinggraphen; `undefined`, wenn der Graph es nicht sagt
   *  (gebaut vor 0.10.2) oder keiner da ist. */
  graphRegionen?: readonly string[];
  /** Wann der Graph gebaut wurde (ms). */
  graphStand?: number;
  /** Je Region: der Suchindex, falls vorhanden. */
  suche: Readonly<Record<string, { format?: number; stand?: number } | undefined>>;
  /** Je Region: wann die Karte (Kacheln) zuletzt kam (ms). */
  kacheln: Readonly<Record<string, number | undefined>>;
  /** Format, das ein aktueller Suchindex hat (`LITE_INDEX_FORMAT`). */
  sucheFormat: number;
}

/**
 * Nur das, was fehlt oder veraltet ist (0.40.0).
 *
 * ─── DIE MELDUNG ────────────────────────────────────────────────────────────
 * „Gibt es eine Möglichkeit inkrementell die Karte, Routen und Suchindex
 * aufzubauen? Wenn ich jetzt noch beispielsweise Österreich dazu lade dann
 * würde ich gerne nur Österreich bauen und nicht alles nochmal."
 *
 * ─── WAS SICH EINZELN BAUEN LÄSST UND WAS NICHT ─────────────────────────────
 * - Karte: ohnehin je Region, die Installation selbst.
 * - Suche: je Region eine Datei. Gebaut wird sie, wenn sie fehlt, ein älteres
 *   Format hat (vor Firmen/Hausnummern) oder älter ist als die Karte.
 * - Routing: EIN Graph über alle Karten. Das ist keine Bequemlichkeit,
 *   sondern die Bedingung für Routen über die Grenze: Valhalla verbindet
 *   Straßen nur innerhalb eines Baus. Zwei getrennt gebaute Graphen hätten an
 *   jeder Grenze ein Loch. Er wird deshalb nur neu gebaut, wenn sich die
 *   Menge der Karten geändert hat oder eine Karte neuer ist als er — dann
 *   aber über alle.
 *
 * `ohneQuelle`: Karten ohne OSM-Extrakt (von Hand abgelegt) können nie in
 * den Graphen. Ohne diese Ausnahme stünde Routing bei jedem Lauf wieder an.
 */
export function noetigerPlan(
  regionen: readonly string[],
  bestand: Baubestand,
  opts: { alles?: boolean; ohneQuelle?: readonly string[] } = {},
): Bauschritt[] {
  if (opts.alles) return gesamtplan(regionen);
  if (regionen.length === 0) return [];
  const sortiert = [...regionen].sort();
  const mitQuelle = sortiert.filter((r) => !(opts.ohneQuelle ?? []).includes(r));
  const schritte: Bauschritt[] = [];

  const imGraph = bestand.graphRegionen ? new Set(bestand.graphRegionen) : null;
  const graphFehlt =
    mitQuelle.length > 0 &&
    (imGraph === null ||
      mitQuelle.some((r) => !imGraph.has(r)) ||
      [...imGraph].some((r) => !sortiert.includes(r)) ||
      (bestand.graphStand !== undefined &&
        mitQuelle.some((r) => (bestand.kacheln[r] ?? 0) > (bestand.graphStand ?? 0))));
  if (graphFehlt) schritte.push({ bauart: 'routing', region: sortiert[0] as string });

  for (const r of mitQuelle) {
    const index = bestand.suche[r];
    const veraltet =
      !index ||
      (index.format ?? 1) < bestand.sucheFormat ||
      (index.stand !== undefined && (bestand.kacheln[r] ?? 0) > index.stand);
    if (veraltet) schritte.push({ bauart: 'suche', region: r });
  }
  return schritte;
}

/** Aus dem Baustatus (`collectBuildStatus`) die Eingabe für `noetigerPlan`. */
export function bestandAus(
  status: {
    tiles: ReadonlyArray<{ region: string; built_at?: string }>;
    routing: { present: boolean; built_at?: string; regions?: string[] };
    search: ReadonlyArray<{ region?: string; built_at?: string; veraltet?: boolean }>;
  },
  sucheFormat: number,
): Baubestand {
  const ms = (iso?: string): number | undefined => {
    const t = iso ? Date.parse(iso) : NaN;
    return Number.isFinite(t) ? t : undefined;
  };
  const suche: Record<string, { format?: number; stand?: number }> = {};
  for (const s of status.search) {
    if (!s.region) continue;
    suche[s.region] = { format: s.veraltet ? 1 : sucheFormat, stand: ms(s.built_at) };
  }
  const kacheln: Record<string, number | undefined> = {};
  for (const t of status.tiles) kacheln[t.region] = ms(t.built_at);
  return {
    graphRegionen: status.routing.present ? status.routing.regions : undefined,
    graphStand: status.routing.present ? ms(status.routing.built_at) : undefined,
    suche,
    kacheln,
    sucheFormat,
  };
}

/** Die Schlusszeile: was dieser Lauf gebaut hat. */
export function fertigText(plan: readonly Bauschritt[], regionen: readonly string[]): string {
  const routing = plan.some((s) => s.bauart === 'routing');
  const suche = plan.filter((s) => s.bauart === 'suche').map((s) => s.region);
  const teile: string[] = [];
  if (routing) {
    teile.push(regionen.length === 1 ? 'Routing' : `Routing über ${regionen.length} Karten`);
  }
  if (suche.length === regionen.length && suche.length > 1) teile.push(`Suche für ${suche.length} Karten`);
  else if (suche.length > 0) teile.push(`Suche für ${suche.join(', ')}`);
  return `Gebaut: ${teile.join(' und ')}.`;
}

/** Was in der Oberfläche über einem Schritt steht. */
export function schrittText(schritt: Bauschritt, regionen: readonly string[]): string {
  if (schritt.bauart === 'routing') {
    return regionen.length === 1
      ? `Routing bauen (${regionen[0]})`
      : `Routing bauen (${regionen.length} Karten)`;
  }
  return `Suche bauen (${schritt.region})`;
}

function variante(schritt: Bauschritt): BuildVariant {
  return schritt.bauart === 'routing' ? GRAPH_BUILD : LITE_INDEX_BUILD;
}

export interface GesamtbauEingabe {
  jobId: string;
  jobs: JobRegistry;
  /** Die installierten Karten. */
  regionen: readonly string[];
  /** Katalogeintrag je Region — für `pbfUrl`. */
  eintragFuer: (region: string) => CatalogEntry | undefined;
  tilesDir: string;
  /** Wo die gemessenen Dauern liegen. */
  bauzeitenPfad: string;
  /** Zusätzliche Umgebung für den Routingschritt (`YAPAIA_GRAPH_EXTRAKTE`). */
  routingEnv?: Record<string, string>;
  /** Die Schritte; ohne Angabe alle (`gesamtplan`). */
  plan?: Bauschritt[];
  /** Nach dem Routingschritt: welche installierten Karten FEHLEN im Graphen?
   *  Eine Karte, deren Extrakt nicht zu laden war, blieb bis 0.40.0 still
   *  draußen — der Lauf meldete „Alles neu gebaut". */
  fehltImGraph?: () => string[];
  deps?: BuildJobDeps;
  /** Nur für Tests. */
  jetzt?: () => number;
  /** Nur für Tests — sonst die echten Funktionen aus `bauzeitSpeicher`. */
  speicher?: {
    lesen: (pfad: string, jetzt: number) => Bauerfahrung;
    merken: (pfad: string, schluessel: string, sekunden: number, jetzt: number) => void;
  };
}

/**
 * Fährt den ganzen Ablauf. Kehrt sofort zurück; der Job trägt den Stand.
 *
 * Wirft nie: der Aufrufer ist eine Route, die bereits mit 202 geantwortet hat.
 */
export function starteGesamtbau(eingabe: GesamtbauEingabe): void {
  const {
    jobId,
    jobs,
    regionen,
    eintragFuer,
    tilesDir,
    bauzeitenPfad,
    routingEnv = {},
    deps = {},
    fehltImGraph,
  } = eingabe;
  const jetzt = eingabe.jetzt ?? ((): number => Date.now());
  const speicher = eingabe.speicher ?? { lesen: leseErfahrung, merken: merkeDauer };

  const plan = eingabe.plan ?? gesamtplan(regionen);
  let warnung = '';
  if (regionen.length === 0) {
    jobs.markError(jobId, {
      code: 'NO_REGIONS',
      message:
        'Es ist keine Karte installiert. Es gibt also nichts zu bauen — ' +
        'installiere zuerst eine Karte.',
    });
    return;
  }
  if (plan.length === 0) {
    jobs.setNote(jobId, 'Alles aktuell — es gab nichts zu bauen.');
    jobs.markDone(jobId);
    return;
  }

  // EINMAL gelesen, zu Beginn. Was während des Laufs dazukommt, sind die
  // Messungen dieses Laufs selbst -- die als Erfahrung für denselben Lauf zu
  // verwenden, wäre zirkulär.
  const erfahrung = speicher.lesen(bauzeitenPfad, jetzt());

  let erledigt = 0;
  let schrittStartMs = jetzt();

  jobs.setGesamtstand(jobId, (): Gesamtstand => {
    const laufend = plan[Math.min(erledigt, plan.length - 1)];
    const auskunft = restdauer({
      plan,
      erledigt,
      laufendSeitMs: jetzt() - schrittStartMs,
      erfahrung,
      alleRegionen: regionen,
    });
    return {
      // 1-basiert: „Schritt 0 von 4" liest niemand gern.
      schritt: Math.min(erledigt + 1, plan.length),
      schritte: plan.length,
      schrittText: schrittText(laufend, regionen),
      restSekunden: auskunft.sekunden,
      restGrund: auskunft.grund,
      restText: restText(auskunft),
    };
  });

  const naechster = (): void => {
    if (erledigt >= plan.length) {
      jobs.setNote(jobId, `${fertigText(plan, regionen)}${warnung}`);
      jobs.markDone(jobId);
      return;
    }

    const schritt = plan[erledigt];
    const eintrag = eintragFuer(schritt.region);
    if (!eintrag) {
      // Eine installierte Karte ohne Katalogeintrag: eine von Hand abgelegte
      // `.pmtiles`. Sie hat keine OSM-Quelle, also lässt sich für sie nichts
      // bauen. Der Ablauf bricht deswegen NICHT ab -- die anderen Karten
      // können sehr wohl gebaut werden, und ein Lauf, der an der ersten
      // Handablage stirbt, wäre für den Rest wertlos.
      jobs.setNote(
        jobId,
        `Übersprungen: für „${schritt.region}" ist keine OpenStreetMap-Quelle hinterlegt.`,
      );
      erledigt += 1;
      schrittStartMs = jetzt();
      naechster();
      return;
    }

    schrittStartMs = jetzt();
    const begonnen = schrittStartMs;
    jobs.setNote(jobId, `${schrittText(schritt, regionen)} …`);

    laufeBau(
      jobId,
      jobs,
      eintrag,
      tilesDir,
      deps,
      variante(schritt),
      schritt.bauart === 'routing' ? routingEnv : {},
      (ergebnis) => {
        if (ergebnis.art === 'abgebrochen') {
          jobs.markError(jobId, ABBRUCH_MELDUNG);
          return;
        }
        if (ergebnis.art === 'fehler') {
          // ─── EIN FEHLGESCHLAGENER SCHRITT BEENDET DEN LAUF ──────────────
          // Weiterzumachen hiesse, am Ende „fertig" zu melden, obwohl das
          // Routing fehlt. Genau diese Sorte halbes Grün ist das, was dieses
          // Projekt am teuersten zu stehen gekommen ist.
          jobs.markError(jobId, {
            ...ergebnis.info,
            message:
              `Schritt ${erledigt + 1} von ${plan.length} (${schrittText(schritt, regionen)}) ` +
              `ist fehlgeschlagen. ${ergebnis.info.message}`,
          });
          return;
        }

        // Geschafft: die gemessene Dauer merken. Sie ist die Grundlage der
        // Restzeit beim NÄCHSTEN Lauf.
        if (schritt.bauart === 'routing' && fehltImGraph) {
          const fehlt = fehltImGraph();
          if (fehlt.length > 0) {
            warnung =
              ` ACHTUNG: im Routing fehlt ${fehlt.join(', ')} — der OSM-Extrakt war nicht zu laden. ` +
              'Dorthin lässt sich nicht routen. Erneut „Bauen" versuchen; das Add-on-Protokoll nennt den Grund.';
          }
        }
        const gedauert = (jetzt() - begonnen) / 1000;
        speicher.merken(bauzeitenPfad, schluessel(schritt, regionen), gedauert, jetzt());

        erledigt += 1;
        naechster();
      },
    );
  };

  jobs.markRunning(jobId, null);
  naechster();
}
