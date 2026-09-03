/**
 * Kachelbau als Hintergrund-Job (Backlog B-04).
 *
 * ─── WARUM ES DIESEN WEG BRAUCHT ────────────────────────────────────────────
 * Es gibt keine fertigen PMTiles zum Herunterladen (siehe `catalog.ts`); die
 * Kacheln werden aus einem OSM-Extrakt gebaut. Bis hierher ging das nur auf
 * einer Kommandozeile IM Add-on-Container -- und genau dorthin kommt ein
 * Betreiber nicht: das Terminal-Add-on laeuft standardmaessig im
 * „Protection Mode", der den Docker-Socket ausblendet, also scheitert schon
 * `docker exec`. Damit war der eine Schritt, ohne den es ueberhaupt keine
 * Karte gibt, fuer den vorgesehenen Bedienweg unerreichbar.
 *
 * Dieser Job schliesst die Luecke: der Core startet das Bau-Skript SELBST --
 * er laeuft ja bereits in dem Container, in dem Java und das Skript liegen.
 *
 * ─── WAS HIER BEWUSST NICHT GEBAUT IST ──────────────────────────────────────
 * Kein Ueberleben eines Add-on-Neustarts. Die `JobRegistry` haelt Jobs im
 * Speicher; wird der Container neu gestartet, ist der Job weg. Das ist
 * vertretbar und KEIN Datenverlust, weil das Skript erst nach vollstaendiger
 * Pruefung atomar einwechselt (W-17): ein abgebrochener Lauf hinterlaesst
 * die bisherige Kartendatei unangetastet, und ein erneuter Start beginnt
 * sauber von vorn. Ein halb eingewechselter Kachelstand kann nicht
 * entstehen. Das ehrlich zu benennen ist besser, als Dauerhaftigkeit
 * vorzutaeuschen, die es nicht gibt.
 *
 * ─── FORTSCHRITT ────────────────────────────────────────────────────────────
 * Ein Prozentwert waere hier erfunden: planetilers Ausgabe laesst sich nicht
 * versionsstabil in eine Zahl uebersetzen, und die Phasen (PBF laden, Knoten
 * lesen, Kacheln schreiben) sind unterschiedlich lang. Der Job meldet
 * deshalb `progress: 0` und stattdessen die letzte Ausgabezeile als `note`.
 * Die Oberflaeche zeigt einen unbestimmten Balken plus diese Zeile -- das
 * sagt „es laeuft und woran", ohne eine Genauigkeit zu behaupten, die nicht
 * da ist.
 */

import { spawn as nodeSpawn } from 'child_process';
import { Buffer } from 'node:buffer';
import { freemem as osFreemem } from 'os';
import type { CatalogEntry } from './catalog.js';
import type { JobRegistry } from './jobs.js';

/** Der Wrapper aus `yapaja_go/rootfs/usr/bin/` -- er setzt TILES_DIR, holt
 *  beim ersten Lauf planetiler.jar und ruft dann das eigentliche Skript. */
export const BUILD_COMMAND = '/usr/bin/yapaja-build-pmtiles';

/** Der Wrapper fuer den ROUTINGGRAPHEN. Er benutzt die
 *  `valhalla_build_*`-Werkzeuge, die im Add-on-Image ohnehin schon liegen
 *  (das Image setzt auf `gis-ops/docker-valhalla` auf). */
export const GRAPH_BUILD_COMMAND = '/usr/bin/yapaja-build-graph';

/**
 * Job-Art aller schweren Bauten. BEWUSST EINE einzige Art fuer Kacheln UND
 * Routinggraph, nicht zwei:
 *
 *  * Der Kachelbau und der Graphbau teilen sich Platte und Arbeitsspeicher
 *    derselben 8-GB-VM. Nebeneinander laufen sie ihr gegenseitig -- und den
 *    Rest von Home Assistant -- in den OOM-Killer.
 *  * Zwei Kachelbauten zerstoeren einander zusaetzlich ueber das gemeinsame
 *    planetiler-Quellenverzeichnis (siehe `JobRegistry.findUnfinished`).
 *
 * Eine gemeinsame Art heisst: es laeuft immer hoechstens EIN schwerer Bau.
 */
export const BUILD_JOB_KIND = 'heavy-build';

/** Was einen Bau-Lauf von einem anderen unterscheidet: das Werkzeug und die
 *  Woerter, mit denen ueber ihn geredet wird. Der Ablauf drumherum
 *  (Vorpruefungen, Ausgabe spiegeln, Abbruch, atomarer Swap) ist derselbe. */
export interface BuildVariant {
  command: string;
  /** Praefix der gespiegelten Ausgabezeilen im Add-on-Protokoll. */
  logPrefix: string;
  /** Wie der Lauf in einer Fehlermeldung heisst. */
  humanName: string;
  doneNote: string;
}

export const TILE_BUILD: BuildVariant = {
  command: BUILD_COMMAND,
  logPrefix: 'Kachelbau',
  humanName: 'Der Kachelbau',
  doneNote: 'Kacheln fertig eingewechselt.',
};

/** Der Wrapper fuer den OFFLINE-SUCHINDEX. Er benutzt `osmium` (seit 0.3.4
 *  im Image) und das gebaute Index-Werkzeug `dist/lite-index.js`. Bis dahin
 *  hiess es, das ginge auf dem Geraet nicht -- das beschrieb aber nur, was
 *  wir ins Image gelegt hatten, keine technische Grenze. */
export const LITE_INDEX_BUILD_COMMAND = '/usr/bin/yapaja-build-lite-index';

export const GRAPH_BUILD: BuildVariant = {
  command: GRAPH_BUILD_COMMAND,
  logPrefix: 'Routingbau',
  humanName: 'Der Bau des Routinggraphen',
  doneNote: 'Routinggraph fertig eingewechselt. Der Dienst startet binnen 30 Sekunden von allein.',
};

export const LITE_INDEX_BUILD: BuildVariant = {
  command: LITE_INDEX_BUILD_COMMAND,
  logPrefix: 'Suchindex',
  humanName: 'Der Bau des Suchindex',
  doneNote: 'Suchindex fertig. Die Adresssuche ist ab sofort nutzbar — ohne Neustart.',
};

/** JVM-Heap fuer planetiler. 2 GB ist der Wert, mit dem eine kleine bis
 *  mittlere Region (Liechtenstein bis Bundesland) durchlaeuft, ohne eine
 *  8-GB-VM neben Home Assistant zu sprengen. */
export const BUILD_HEAP_BYTES = 2 * 1024 ** 3;

/** Zusaetzlich zum Heap braucht der Prozess Platz fuer JVM-Overhead und
 *  Dateipuffer. Konservativ, weil ein OOM auf einer HAOS-VM nicht unbedingt
 *  planetiler trifft, sondern Home Assistant. */
export const BUILD_RAM_OVERHEAD_BYTES = 512 * 1024 ** 2;

/**
 * Plattenbedarf: die fertige Datei PLUS Arbeitsraum fuer das Zwischen-
 * ergebnis, das planetiler waehrend des Laufs anlegt. Der Faktor ist eine
 * dokumentierte Faustregel, keine Messung -- deshalb steht er hier benannt
 * und nicht als magische Zahl im Code.
 */
export const BUILD_DISK_FACTOR = 3;

export function buildRequiredBytes(entry: CatalogEntry): number {
  return entry.sizeBytes * BUILD_DISK_FACTOR;
}

export function buildRequiredFreeMemory(): number {
  return BUILD_HEAP_BYTES + BUILD_RAM_OVERHEAD_BYTES;
}

/** Minimaler Ausschnitt aus `child_process.spawn`, den dieses Modul braucht.
 *  Als eigener Typ, damit Tests ein Stub-Programm einsetzen koennen, ohne
 *  Node-Interna nachbauen zu muessen. */
export interface SpawnedBuild {
  stdout: { on(event: 'data', cb: (chunk: Buffer | string) => void): void } | null;
  stderr: { on(event: 'data', cb: (chunk: Buffer | string) => void): void } | null;
  on(event: 'close', cb: (code: number | null) => void): void;
  on(event: 'error', cb: (err: Error) => void): void;
  kill(signal?: string): boolean;
}

export type SpawnBuildFn = (
  command: string,
  args: string[],
  env: Record<string, string | undefined>,
) => SpawnedBuild;

export interface BuildJobDeps {
  spawnFn?: SpawnBuildFn;
  freeMemFn?: () => number;
  /** Wohin die Ausgabe des Bau-Prozesses gespiegelt wird. In Produktion der
   *  Fastify-Logger, dessen stdout im Add-on-Protokoll landet. */
  logger?: (line: string) => void;
}

/** Letzte nicht-leere Zeile aus einem Ausgabe-Klumpen. Planetiler schreibt
 *  fortlaufend; fuer die Anzeige interessiert nur der aktuelle Stand. */
export function lastMeaningfulLine(chunk: string): string | null {
  const lines = chunk
    .split(/\r?\n|\r/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0);
  return lines.length > 0 ? lines[lines.length - 1] : null;
}

/** Kappt eine Ausgabezeile auf eine Laenge, die in der Oberflaeche noch
 *  lesbar ist -- planetiler schreibt sehr lange Statuszeilen. */
export function truncateNote(line: string, max = 160): string {
  return line.length <= max ? line : `${line.slice(0, max - 1)}…`;
}

/**
 * Startet den Bau im Hintergrund. Der Aufrufer (Route) hat den Job bereits
 * angelegt und mit 202 geantwortet; hier wird nichts mehr erwartet.
 */
export function runBuildJob(
  jobId: string,
  jobs: JobRegistry,
  entry: CatalogEntry,
  tilesDir: string,
  deps: BuildJobDeps = {},
  variant: BuildVariant = TILE_BUILD,
): void {
  const logger = deps.logger;
  const spawnFn: SpawnBuildFn =
    deps.spawnFn ??
    ((command, args, env) =>
      nodeSpawn(command, args, { env: { ...process.env, ...env } }) as unknown as SpawnedBuild);

  const source = entry.pbfUrl;
  if (!source) {
    jobs.markError(jobId, {
      code: 'NO_BUILD_SOURCE',
      message:
        `Für die Region "${entry.id}" ist kein OSM-Extrakt hinterlegt (pbfUrl). ` +
        'Ohne Quelle lässt sich nichts bauen.',
    });
    return;
  }

  jobs.markRunning(jobId, null);
  jobs.setNote(jobId, 'Bau wird gestartet…');

  let child: SpawnedBuild;
  try {
    child = spawnFn(variant.command, [source, entry.id], {
      TILES_DIR: tilesDir,
      PLANETILER_XMX: `${Math.round(BUILD_HEAP_BYTES / 1024 ** 3)}g`,
    });
  } catch (err) {
    jobs.markError(jobId, {
      code: 'BUILD_START_FAILED',
      message: `Der Bau konnte nicht gestartet werden: ${
        err instanceof Error ? err.message : String(err)
      }`,
    });
    return;
  }

  // Ein Abbruch aus der Oberfläche muss den Prozess wirklich beenden --
  // sonst läuft planetiler stundenlang weiter, während die Anzeige
  // „abgebrochen" behauptet.
  //
  // Der Job wird SOFORT beendet, nicht erst wenn das Kind wirklich stirbt.
  // Andernfalls entsteht eine Falle: seit ein laufender Bau jeden weiteren
  // sperrt (BUILD_JOB_KIND), wuerde ein Kindprozess, der auf SIGTERM nicht
  // reagiert, den Knopf „Kacheln bauen" bis zum Neustart des Add-ons
  // blockieren -- und ein Add-on-Neustart ist genau die Art Ausweg, die auf
  // dem vorgesehenen Bedienweg niemand finden soll.
  //
  // `markError` auf einem bereits beendeten Job ist ein No-op, der
  // `close`-Zweig unten darf also gefahrlos noch einmal dasselbe tun.
  jobs.setOnCancel(jobId, () => {
    child.kill('SIGTERM');
    jobs.markError(jobId, {
      code: 'CANCELLED',
      message:
        'Bau abgebrochen. Die bisherige Kartendatei ist unverändert — das Skript ' +
        'wechselt erst nach vollständiger Prüfung ein (W-17).',
    });
  });

  // Die Ausgabe geht an ZWEI Stellen, und beide werden gebraucht:
  //
  //   * die letzte Zeile als `note` -> Fortschritt in der Oberflaeche;
  //   * der volle Text ins Add-on-Protokoll.
  //
  // Der zweite Teil fehlte. Die Fehlermeldung sagte „ausfuehrliche Ausgabe im
  // Add-on-Protokoll" -- dorthin kam aber nie etwas, weil wir die Pipes des
  // Kindprozesses lesen und nirgendwo hinschreiben. Beim ersten echten
  // Fehlschlag stand deshalb nur „Code 1" da und sonst nichts: der einzige
  // Text, der die Ursache genannt haette, wurde verworfen. Ein Verweis auf
  // ein Protokoll, in dem nichts steht, ist dasselbe wie eine Anweisung auf
  // einen Knopf, den es nicht gibt.
  const forward = (chunk: Buffer | string): void => {
    const text = chunk.toString();
    for (const raw of text.split(/\r?\n|\r/)) {
      const line = raw.trim();
      if (line.length > 0) {
        logger?.(`[${variant.logPrefix} ${entry.id}] ${line}`);
      }
    }
    const last = lastMeaningfulLine(text);
    if (last) {
      jobs.setNote(jobId, truncateNote(last));
    }
  };
  child.stdout?.on('data', forward);
  child.stderr?.on('data', forward);

  child.on('error', (err) => {
    jobs.markError(jobId, {
      code: 'BUILD_START_FAILED',
      message:
        `Der Bau konnte nicht gestartet werden: ${err.message}. ` +
        `Erwartet wurde das Werkzeug ${variant.command} — es gehört zum Add-on-Image.`,
    });
  });

  child.on('close', (code) => {
    if (jobs.isCancelled(jobId)) {
      jobs.markError(jobId, {
        code: 'CANCELLED',
        message:
          'Bau abgebrochen. Die bisherige Kartendatei ist unverändert — das Skript ' +
          'wechselt erst nach vollständiger Prüfung ein (W-17).',
      });
      return;
    }
    if (code === 0) {
      jobs.setNote(jobId, variant.doneNote);
      jobs.markDone(jobId);
      return;
    }
    // Die letzte Ausgabezeile gehoert IN die Fehlermeldung. Sie steht zwar
    // auch als `note` im Job, aber die Oberflaeche zeigt im Fehlerfall die
    // Meldung -- wer nur dorthin schaut, saehe sonst „Code 1" und sonst
    // nichts.
    const lastLine = jobs.get(jobId)?.note;
    jobs.markError(jobId, {
      code: 'BUILD_FAILED',
      message:
        `${variant.humanName} ist mit Code ${code ?? 'unbekannt'} fehlgeschlagen. ` +
        (lastLine ? `Zuletzt: „${lastLine}". ` : '') +
        'Die vollständige Ausgabe steht im Add-on-Protokoll (Zeilen mit ' +
        `„[${variant.logPrefix} ${entry.id}]"). Der bisherige Stand ist unverändert.`,
    });
  });
}

export { osFreemem as defaultFreeMem };
