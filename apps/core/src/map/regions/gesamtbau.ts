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
  } = eingabe;
  const jetzt = eingabe.jetzt ?? ((): number => Date.now());
  const speicher = eingabe.speicher ?? { lesen: leseErfahrung, merken: merkeDauer };

  const plan = gesamtplan(regionen);
  if (plan.length === 0) {
    jobs.markError(jobId, {
      code: 'NO_REGIONS',
      message:
        'Es ist keine Karte installiert. Es gibt also nichts zu bauen — ' +
        'installiere zuerst eine Karte.',
    });
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
      jobs.setNote(
        jobId,
        `Alles neu gebaut: Routing und Suche für ${regionen.length === 1 ? 'eine Karte' : `${regionen.length} Karten`}.`,
      );
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
