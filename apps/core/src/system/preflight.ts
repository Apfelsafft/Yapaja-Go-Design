/* eslint-disable no-undef -- `AbortController`, `setTimeout`/`clearTimeout`
 * und `fetch` sind Standard-Globals unter Node 22 (typisiert über
 * @types/node); die gemeinsame eslint-`globals`-Liste ist älter als diese
 * Backend-Module und kennt nur console/process/DOM. Gleiche Begründung wie
 * in `addons/proxy.ts` und `routing/valhallaClient.ts`. */

/**
 * Installationsprüfung („Preflight") — `feat/gui-install-path`.
 *
 * WOZU
 * ----
 * Yapaja Go besteht nicht nur aus dem Core-Prozess. Damit navigiert werden
 * kann, müssen daneben Dinge existieren, die NICHT im Add-on-Image stecken,
 * weil sie gerätespezifisch und gigabytegroß sind: die Kartenkacheln
 * (`*.pmtiles`), der Valhalla-Routinggraph, ein Suchindex (Photon ODER der
 * Lite-Index aus W-12) und eine Positionsquelle.
 *
 * Fehlt eines davon, verhält sich die App bisher zwar korrekt (kein Absturz,
 * saubere Fehlermeldungen an der jeweiligen Stelle) — aber der Betreiber
 * erfährt es erst, wenn er die betroffene Funktion benutzt, und dann pro
 * Funktion einzeln. Wer das Add-on über die Home-Assistant-GUI installiert
 * hat und ausdrücklich NICHT über SSH arbeiten will, hat sonst keinen Weg,
 * den Zustand seiner Installation überhaupt zu sehen.
 *
 * Diese Prüfung beantwortet in EINEM Aufruf: was fehlt, wie schlimm es ist,
 * und was konkret dagegen zu tun ist.
 *
 * WAS SIE AUSDRÜCKLICH NICHT IST
 * ------------------------------
 * Kein Ersatz für `GET /api/v1/health`. Health ist eine Liveness-Sonde:
 * billig, ohne Netzzugriff, geeignet für einen Supervisor-Watchdog.
 * Preflight darf teuer sein — sie öffnet TCP-Verbindungen zu Valhalla,
 * Photon und gpsd und liest das Dateisystem. Sie wird von der GUI auf
 * Anforderung aufgerufen, nicht im Sekundentakt.
 *
 * AUFBAU
 * ------
 * Jede Prüfung liefert dieselbe Struktur, damit die GUI sie generisch
 * darstellen kann und eine neue Prüfung kein Frontend-Update braucht.
 * `severity` trennt „geht gar nicht" von „geht, aber eingeschränkt":
 *
 *   - `required`  fehlt → die Kernfunktion (Karte + Route) ist unbenutzbar
 *   - `recommended` fehlt → Yapaja läuft, eine Teilfunktion fehlt
 *   - `optional`  fehlt → reine Zusatzfunktion, kein Mangel
 *
 * `remedy` ist der eigentliche Zweck der Datei: eine Anweisung in ganzen
 * Sätzen, die auf einen Weg in der GUI zeigt, wo es einen gibt. Ein
 * Prüfergebnis ohne Handlungsanweisung ist für den Adressaten wertlos —
 * genau deshalb ist `remedy` bei allem außer `ok` verpflichtend (und
 * `preflight.test.ts` erzwingt das).
 *
 * TESTBARKEIT
 * -----------
 * Sämtliche Außenkontakte (Verzeichnis lesen, Datei statten, TCP öffnen,
 * HTTP holen, RAM abfragen) kommen über `PreflightDeps` herein. Kein Test
 * greift auf einen echten Host oder ein echtes Verzeichnis zu, und
 * umgekehrt kann kein Test „grün" sein, weil ein Ergebnis fest verdrahtet
 * wurde — die Tests belegen, dass die Werte wirklich aus den (gefälschten)
 * Sonden stammen.
 */

import { readdir, stat } from 'fs/promises';
import { totalmem } from 'os';
import { createConnection } from 'net';
import { resolveTilesDir } from '../map/paths.js';
import { resolveLiteSearchDbPath } from '../search/lite/paths.js';

/** Kennung einer Prüfung. Stabil — die GUI und die Doku verweisen darauf. */
export type PreflightCheckId =
  | 'tiles'
  | 'routing'
  | 'search'
  | 'position'
  | 'memory'
  | 'disk'
  | 'mqtt';

export type PreflightStatus = 'ok' | 'warn' | 'fail';

export type PreflightSeverity = 'required' | 'recommended' | 'optional';

export interface PreflightCheck {
  id: PreflightCheckId;
  /** Kurzer Titel für die GUI (deutsch). */
  label: string;
  status: PreflightStatus;
  severity: PreflightSeverity;
  /** Was tatsächlich vorgefunden wurde — mit Zahlen/Pfaden, nicht nur „ok". */
  detail: string;
  /** Was dagegen zu tun ist. Bei `status !== 'ok'` immer gesetzt. */
  remedy?: string;
}

export interface PreflightReport {
  /** `fail`, wenn eine `required`-Prüfung fehlschlägt; sonst `warn`, wenn
   *  irgendetwas nicht `ok` ist; sonst `ok`. */
  status: PreflightStatus;
  /** Ein Satz, der den Gesamtzustand beschreibt (deutsch). */
  summary: string;
  checks: PreflightCheck[];
  /** Wann gemessen wurde (ISO-8601) — die GUI zeigt sonst beliebig alte
   *  Ergebnisse ohne Hinweis darauf an. */
  checkedAt: string;
}

// ───────────────────────── Sonden (injizierbar) ─────────────────────────

/** Verzeichnisinhalt; wirft, wenn es das Verzeichnis nicht gibt. */
export type ListDirFn = (path: string) => Promise<string[]>;
/** Dateigröße in Bytes, oder `null`, wenn es die Datei nicht gibt. */
export type FileSizeFn = (path: string) => Promise<number | null>;
/** Ist an `host:port` etwas erreichbar? Nur TCP, kein Protokoll. */
export type TcpProbeFn = (host: string, port: number, timeoutMs: number) => Promise<boolean>;
/** Antwortet `url` mit einem HTTP-Status < 500? */
export type HttpProbeFn = (url: string, timeoutMs: number) => Promise<boolean>;

export interface PreflightDeps {
  listDir?: ListDirFn;
  fileSize?: FileSizeFn;
  tcpProbe?: TcpProbeFn;
  httpProbe?: HttpProbeFn;
  totalMem?: () => number;
  /** Freier Plattenplatz im Datenverzeichnis, in Bytes. */
  diskFree?: (path: string) => Promise<number>;
  /** Ersetzt `process.env` — so kann ein Test eine ganze Konfiguration
   *  durchspielen, ohne globale Variablen zu verändern (parallele Tests). */
  env?: Record<string, string | undefined>;
  now?: () => Date;
}

/** Zeitbudget je Netzsonde. Bewusst knapp: die Prüfung läuft auf Anforderung
 *  in der GUI, und ein nicht laufender Dienst soll als „fehlt" erscheinen,
 *  nicht als Hänger. Fünf Sonden × 1,5 s ist auch im schlimmsten Fall eine
 *  Antwortzeit, die ein Bedienelement noch aushält. */
export const PROBE_TIMEOUT_MS = 1500;

/** Ab wann die Vollausstattung (Photon + Valhalla + Core) auf einem Gerät
 *  eng wird. 8 GB ist der real vermessene Fall (HAOS-VM unter Proxmox):
 *  Photon will allein ~2 GB Heap, Valhalla je nach Region ähnlich viel, und
 *  Home Assistant selbst läuft daneben weiter. Das ist keine harte Grenze,
 *  sondern der Punkt, ab dem der Lite-Index (W-12) die verlässlichere Wahl
 *  ist — deshalb `warn` und nicht `fail`. */
export const PHOTON_COMFORTABLE_RAM_BYTES = 10 * 1024 * 1024 * 1024;

async function defaultListDir(path: string): Promise<string[]> {
  return readdir(path);
}

async function defaultFileSize(path: string): Promise<number | null> {
  try {
    const info = await stat(path);
    return info.isFile() ? info.size : null;
  } catch {
    return null;
  }
}

function defaultTcpProbe(host: string, port: number, timeoutMs: number): Promise<boolean> {
  return new Promise((resolvePromise) => {
    let settled = false;
    const finish = (result: boolean): void => {
      if (!settled) {
        settled = true;
        socket.destroy();
        resolvePromise(result);
      }
    };
    const socket = createConnection({ host, port });
    socket.setTimeout(timeoutMs);
    socket.on('connect', () => finish(true));
    socket.on('timeout', () => finish(false));
    socket.on('error', () => finish(false));
  });
}

async function defaultHttpProbe(url: string, timeoutMs: number): Promise<boolean> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: controller.signal });
    // Ein 404 heißt „Dienst da, Pfad anders" — für die Frage „läuft der
    // Dienst überhaupt" ist das ein JA. Nur 5xx und Verbindungsfehler
    // zählen als nicht erreichbar.
    return res.status < 500;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

async function defaultDiskFree(path: string): Promise<number> {
  const { getSystemResources } = await import('./resources.js');
  const res = await getSystemResources(path);
  return res.disk_free_bytes;
}

// ───────────────────────────── Hilfsmittel ──────────────────────────────

function formatGiB(bytes: number): string {
  return `${(bytes / 1024 ** 3).toFixed(1)} GB`;
}

function formatMiB(bytes: number): string {
  return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
}

// ───────────────────────────── Die Prüfungen ────────────────────────────

async function checkTiles(tilesDir: string, listDir: ListDirFn): Promise<PreflightCheck> {
  const base = {
    id: 'tiles' as const,
    label: 'Kartenkacheln',
    severity: 'required' as const,
  };
  // Diese Anweisung nennt ABSICHTLICH keinen Knopf in der Oberfläche: es gibt
  // keinen. Bis 2026-09-02 stand hier „(Knopf „Kacheln bauen")" — den hat nie
  // jemand gebaut (Backlog B-04). Eine Anweisung, die auf ein Bedienelement
  // zeigt, das der Adressat nicht finden kann, ist genauso wertlos wie die
  // 404-URL, die dieses ganze Thema ausgelöst hat.
  const remedy =
    'Für die mitgelieferten Regionen gibt es keine fertige Datei zum Herunterladen — ' +
    'die Kacheln werden aus OpenStreetMap-Daten gebaut. Das geht direkt hier: ' +
    '„Kartenregionen verwalten" (🗺️ rechts oben) öffnen und bei der gewünschten Region ' +
    'auf „Kacheln bauen" drücken. Liechtenstein braucht Minuten, ein Bundesland wie ' +
    'Rheinland-Pfalz deutlich länger; der Fortschritt steht im Panel. ' +
    'Ganz Deutschland ist für dieses Gerät zu groß: auf einem anderen Rechner bauen und ' +
    'die fertige .pmtiles per „Samba share" nach /share/yapaja/tiles/ legen. ' +
    'Ausführlich: docs/installation.md §C.';

  let entries: string[];
  try {
    entries = await listDir(tilesDir);
  } catch {
    return {
      ...base,
      status: 'fail',
      detail: `Das Kachelverzeichnis ${tilesDir} existiert nicht.`,
      remedy,
    };
  }

  const tiles = entries.filter((name) => name.endsWith('.pmtiles'));
  const partials = entries.filter((name) => name.endsWith('.pmtiles.part'));

  if (tiles.length === 0) {
    return {
      ...base,
      status: 'fail',
      detail:
        partials.length > 0
          ? `Keine fertigen Kacheln in ${tilesDir}, aber ${partials.length} angefangene(r) Download(s) (.part).`
          : `Keine Kacheldatei (*.pmtiles) in ${tilesDir}.`,
      remedy:
        partials.length > 0
          ? 'Ein angefangener Download kann in der Oberfläche unter „Einstellungen → ' +
            'Kartenregionen" fortgesetzt werden — er beginnt nicht von vorn. ' +
            remedy
          : remedy,
    };
  }

  return {
    ...base,
    status: 'ok',
    detail: `${tiles.length} Region(en) installiert: ${tiles
      .map((name) => name.replace(/\.pmtiles$/, ''))
      .join(', ')}.`,
  };
}

async function checkRouting(
  env: Record<string, string | undefined>,
  httpProbe: HttpProbeFn,
): Promise<PreflightCheck> {
  const base = {
    id: 'routing' as const,
    label: 'Routing-Dienst (Valhalla)',
    severity: 'required' as const,
  };
  const url = env.VALHALLA_URL || 'http://localhost:8002';
  // ZWEI FRUEHERE FASSUNGEN DIESES TEXTES WAREN FALSCH.
  //
  // Zuerst stand hier „er wird beim Bau einer Region miterzeugt" -- das tut
  // `build-pmtiles.sh` nicht, es baut ausschliesslich Kacheln.
  //
  // Danach stand hier, der Graph koenne auf dem Geraet „NICHT gebaut werden:
  // das Bauwerkzeug braucht einen Docker-Socket". Das galt fuer unser SKRIPT
  // (`services/valhalla/build-tiles.sh` faehrt ein Image von aussen an), aber
  // nicht fuer die WERKZEUGE: das Add-on-Image setzt mit `FROM` auf
  // `gis-ops/docker-valhalla` auf, dessen Dockerfile `valhalla_build_tiles`,
  // `valhalla_build_config` und Geschwister ausdruecklich aufbewahrt -- samt
  // dem Bau-Rezept unter /valhalla/scripts/. Der Text schickte den Betreiber
  // also an einen zweiten Rechner, obwohl alles Noetige im Container lag.
  //
  // Dieselbe Fehlerklasse wie der JAR-Modus bei planetiler, und derselbe
  // Preis: eine Anweisung, die aus dem vorgesehenen Bedienweg hinausfuehrt.
  const remedy =
    'Valhalla läuft als Teil des Add-ons, braucht aber einen fertigen Routinggraphen; ' +
    'ohne ihn startet der Dienst nicht. Bauen Sie ihn mit dem Knopf „Routing bauen" ' +
    'im Regionen-Panel (🗺️ rechts oben) — bei einer kleinen Region dauert das Minuten. ' +
    'Der Dienst startet danach binnen 30 Sekunden von allein, ein Neustart des Add-ons ' +
    'ist nicht nötig. Ohne Graph funktionieren Karte, Position und Favoriten weiterhin — ' +
    'nur das Berechnen von Routen nicht. Ausführlich: docs/installation.md §C.';

  const reachable = await httpProbe(`${url}/status`, PROBE_TIMEOUT_MS);
  return reachable
    ? { ...base, status: 'ok', detail: `Erreichbar unter ${url}.` }
    : { ...base, status: 'fail', detail: `Unter ${url} antwortet nichts.`, remedy };
}

async function checkSearch(
  env: Record<string, string | undefined>,
  httpProbe: HttpProbeFn,
  fileSize: FileSizeFn,
): Promise<PreflightCheck> {
  const base = {
    id: 'search' as const,
    label: 'Ortssuche',
    severity: 'recommended' as const,
  };

  const photonEnabled = env.PHOTON_ENABLED !== 'false';
  const photonUrl = env.PHOTON_URL || 'http://localhost:2322';
  const liteDbPath = env.LITE_SEARCH_DB_PATH || resolveLiteSearchDbPath();

  const [photonUp, liteBytes] = await Promise.all([
    photonEnabled ? httpProbe(`${photonUrl}/status`, PROBE_TIMEOUT_MS) : Promise.resolve(false),
    fileSize(liteDbPath),
  ]);
  const liteReady = liteBytes !== null && liteBytes > 0;

  // Die Suche ist ODER-verknüpft, und das ist der Kern von W-12: ein Gerät
  // ohne genug RAM für Photon ist nicht suchunfähig, es sucht über den
  // Lite-Index. Eine Prüfung, die nur Photon kennt, würde genau die
  // vorgesehene Sparkonfiguration als Defekt melden.
  if (photonUp && liteReady) {
    return {
      ...base,
      status: 'ok',
      detail: `Photon läuft (${photonUrl}), Lite-Index zusätzlich vorhanden (${formatMiB(liteBytes)}).`,
    };
  }
  if (photonUp) {
    return { ...base, status: 'ok', detail: `Photon läuft unter ${photonUrl}.` };
  }
  if (liteReady) {
    return {
      ...base,
      status: 'ok',
      detail: photonEnabled
        ? `Photon antwortet nicht, aber der Lite-Index ist da (${liteDbPath}, ${formatMiB(liteBytes)}) — die Suche funktioniert darüber.`
        : `Photon ist abgeschaltet; die Suche läuft über den Lite-Index (${liteDbPath}, ${formatMiB(liteBytes)}).`,
    };
  }

  return {
    ...base,
    status: 'warn',
    detail: photonEnabled
      ? `Weder Photon (${photonUrl}) noch ein Lite-Index (${liteDbPath}) sind verfügbar.`
      : `Photon ist abgeschaltet und es gibt keinen Lite-Index (${liteDbPath}).`,
    // Auch hier stand ein Knopf („Suchindex bauen"), den es nicht gibt, und
    // der Lite-Index braucht ohnehin `osmium` und Repo-Werkzeug, die beide
    // nicht im Add-on-Container liegen. Der ehrliche Weg ist derselbe wie
    // beim Routinggraphen: woanders bauen, Datei ablegen.
    remedy:
      'Es gibt zwei Wege, und einer genügt. (1) Lite-Index: braucht wenig RAM, ' +
      'lässt sich auf dem Gerät aber nicht bauen (das Werkzeug dafür setzt osmium ' +
      'und einen Repository-Checkout voraus). Auf einem anderen Rechner mit ' +
      'services/valhalla/build-lite-index.sh <pfad-zur.osm.pbf> bauen und die ' +
      'lite_search.db per „Samba share" nach /share/yapaja/lite-search/ legen. ' +
      'Das ist der empfohlene Weg auf einem Gerät mit 8 GB. (2) Photon: in der ' +
      'Add-on-Konfiguration einschalten und den Index importieren; rechnen Sie mit ' +
      'mehreren GB RAM. Ohne beides bleibt die Adresssuche leer — Navigieren zu ' +
      'Koordinaten und zu Favoriten funktioniert trotzdem.',
  };
}

async function checkPosition(
  env: Record<string, string | undefined>,
  tcpProbe: TcpProbeFn,
): Promise<PreflightCheck> {
  const base = {
    id: 'position' as const,
    label: 'Positionsquelle',
    severity: 'recommended' as const,
  };

  const gpsdEnabled = env.GPSD_ENABLED === 'true' || env.GPSD_ENABLED === '1';
  const simulator = env.ENABLE_SIMULATOR === 'true' || env.ENABLE_SIMULATOR === '1';

  if (gpsdEnabled) {
    const host = env.GPSD_HOST || 'localhost';
    const port = env.GPSD_PORT ? parseInt(env.GPSD_PORT, 10) : 2947;
    const up = await tcpProbe(host, Number.isNaN(port) ? 2947 : port, PROBE_TIMEOUT_MS);
    if (up) {
      return { ...base, status: 'ok', detail: `gpsd erreichbar unter ${host}:${port}.` };
    }
    return {
      ...base,
      status: 'warn',
      detail: `gpsd ist eingeschaltet, antwortet aber nicht unter ${host}:${port}.`,
      remedy:
        'Prüfen Sie, ob der USB-GPS-Empfänger gesteckt ist und ob das Gerät in der ' +
        'Add-on-Konfiguration unter „gps_device" eingetragen ist (meist /dev/ttyACM0 ' +
        'oder /dev/ttyUSB0). Solange gpsd fehlt, kann Yapaja die Position weiterhin ' +
        'aus dem Browser beziehen — Telefon, Tablet oder Autoradio liefern sie über ' +
        'die Standortfreigabe der Seite (ADR-007: gpsd > Browser > Simulator). ' +
        'Achtung: über HA-Ingress muss die Verbindung HTTPS sein, sonst gibt der ' +
        'Browser den Standort nicht frei.',
    };
  }

  // Kein gpsd konfiguriert ist KEIN Fehler: der Browser ist ein vollwertiger,
  // ausdrücklich vorgesehener Weg (ADR-007), und für viele Aufbauten der
  // einzige. Es ist aber ein Hinweis wert, weil er eine Bedingung hat (HTTPS)
  // die man sonst erst im Fahrzeug bemerkt.
  return {
    ...base,
    status: 'warn',
    detail: simulator
      ? 'Kein gpsd konfiguriert. Der Simulator ist eingeschaltet — das ist eine Testquelle, keine echte Position.'
      : 'Kein gpsd konfiguriert. Die Position kommt vom Browser des jeweiligen Geräts.',
    remedy:
      'Wenn das so gewollt ist, ist nichts zu tun: erlauben Sie beim ersten Öffnen ' +
      'der Karte den Standortzugriff. Damit der Browser überhaupt fragt, muss die ' +
      'Seite über HTTPS erreichbar sein (bei Home-Assistant-Ingress ist das der Fall, ' +
      'sofern Home Assistant selbst über HTTPS läuft). Für einen fest eingebauten ' +
      'USB-Empfänger stattdessen in der Add-on-Konfiguration „gpsd_enabled" ' +
      'einschalten und „gps_device" setzen.',
  };
}

function checkMemory(
  env: Record<string, string | undefined>,
  totalMem: () => number,
): PreflightCheck {
  const base = {
    id: 'memory' as const,
    label: 'Arbeitsspeicher',
    severity: 'recommended' as const,
  };
  const total = totalMem();
  const photonEnabled = env.PHOTON_ENABLED !== 'false';

  if (!photonEnabled || total >= PHOTON_COMFORTABLE_RAM_BYTES) {
    return {
      ...base,
      status: 'ok',
      detail: photonEnabled
        ? `${formatGiB(total)} insgesamt — genug für Photon neben Valhalla und Home Assistant.`
        : `${formatGiB(total)} insgesamt; Photon ist abgeschaltet, die Suche läuft über den Lite-Index.`,
    };
  }

  return {
    ...base,
    status: 'warn',
    detail:
      `${formatGiB(total)} insgesamt, und Photon ist eingeschaltet. Photon belegt allein ` +
      'mehrere GB; daneben laufen noch Valhalla, der Core und Home Assistant selbst.',
    remedy:
      'Empfehlung für dieses Gerät: Photon in der Add-on-Konfiguration abschalten ' +
      '(„photon_enabled: false") und stattdessen den Lite-Suchindex verwenden. Der ' +
      'braucht ein Vielfaches weniger Speicher und deckt dieselbe Ortssuche ab ' +
      '(W-12). Wenn Photon bleiben soll, geben Sie der VM mehr RAM — sonst greift ' +
      'irgendwann der OOM-Killer, und zwar nicht unbedingt bei Photon.',
  };
}

async function checkDisk(
  tilesDir: string,
  diskFree: (path: string) => Promise<number>,
): Promise<PreflightCheck> {
  const base = {
    id: 'disk' as const,
    label: 'Freier Speicherplatz',
    severity: 'recommended' as const,
  };
  // 5 GB: eine Deutschland-Kacheldatei liegt laut Katalog bei ~4,5 GB, und
  // der Bau braucht zusätzlich Platz für das Zwischenergebnis. Wer knapper
  // liegt, kann kleine Regionen weiter nutzen — deshalb `warn`.
  const COMFORTABLE_FREE_BYTES = 5 * 1024 ** 3;

  let free: number;
  try {
    free = await diskFree(tilesDir);
  } catch (err) {
    return {
      ...base,
      status: 'warn',
      detail: `Freier Platz für ${tilesDir} nicht ermittelbar: ${
        err instanceof Error ? err.message : String(err)
      }`,
      remedy:
        'Prüfen Sie, ob das Datenverzeichnis des Add-ons vorhanden und beschreibbar ist. ' +
        'Bei einem frisch installierten Add-on legt der erste Start es an.',
    };
  }

  if (free >= COMFORTABLE_FREE_BYTES) {
    return { ...base, status: 'ok', detail: `${formatGiB(free)} frei in ${tilesDir}.` };
  }
  return {
    ...base,
    status: 'warn',
    detail: `Nur ${formatGiB(free)} frei in ${tilesDir}.`,
    remedy:
      'Für eine kleine Region (Liechtenstein, ~15 MB) reicht das. Für eine große ' +
      'Region wie Deutschland (~4,5 GB fertige Kacheln, beim Bau zeitweise deutlich ' +
      'mehr) nicht. Vergrößern Sie die Platte der VM, oder entfernen Sie nicht mehr ' +
      // „Einstellungen → Kartenregionen" gab es nie als Menüpfad. Das Panel
      // öffnet die Schaltfläche „Kartenregionen verwalten" (🗺️) rechts oben.
      'benötigte Regionen über „Kartenregionen verwalten" (🗺️ rechts oben).',
  };
}

function checkMqtt(env: Record<string, string | undefined>): PreflightCheck {
  const base = {
    id: 'mqtt' as const,
    label: 'MQTT / Home-Assistant-Anbindung',
    severity: 'optional' as const,
  };
  const url = env.MQTT_BROKER_URL;
  if (url) {
    return {
      ...base,
      status: 'ok',
      detail: `Broker konfiguriert: ${url}. Den laufenden Verbindungszustand meldet GET /api/v1/health.`,
    };
  }
  return {
    ...base,
    status: 'warn',
    detail: 'Kein MQTT-Broker konfiguriert — Yapaja meldet keine Entitäten an Home Assistant.',
    remedy:
      'Rein optional. Wenn Home Assistant Fahrtdaten (Position, verbleibende Strecke, ' +
      'Ankunftszeit) sehen soll, tragen Sie in der Add-on-Konfiguration die ' +
      'Broker-URL ein — bei einem HAOS-Standardaufbau ist das das Mosquitto-Add-on. ' +
      'Ohne MQTT navigiert Yapaja unverändert.',
  };
}

// ──────────────────────────── Gesamtergebnis ────────────────────────────

function summarize(checks: PreflightCheck[]): { status: PreflightStatus; summary: string } {
  const failed = checks.filter((c) => c.status === 'fail');
  const warned = checks.filter((c) => c.status === 'warn');

  if (failed.length > 0) {
    return {
      status: 'fail',
      summary:
        `${failed.length} Voraussetzung(en) fehlen, ohne die nicht navigiert werden kann: ` +
        `${failed.map((c) => c.label).join(', ')}. Jeder Punkt unten sagt, was zu tun ist.`,
    };
  }
  if (warned.length > 0) {
    return {
      status: 'warn',
      summary:
        `Navigieren ist möglich. ${warned.length} Punkt(e) sind eingeschränkt oder ` +
        `nicht eingerichtet: ${warned.map((c) => c.label).join(', ')}.`,
    };
  }
  return { status: 'ok', summary: 'Alle Voraussetzungen erfüllt.' };
}

/**
 * Führt alle Prüfungen aus. Wirft nicht: eine Prüfung, die selbst
 * fehlschlägt, erscheint als Ergebnis mit `status: 'warn'` — eine
 * Diagnoseseite, die mit einem 500er antwortet, ist genau dann nutzlos,
 * wenn man sie braucht.
 */
export async function runPreflight(deps: PreflightDeps = {}): Promise<PreflightReport> {
  const env = deps.env ?? process.env;
  const listDir = deps.listDir ?? defaultListDir;
  const fileSize = deps.fileSize ?? defaultFileSize;
  const tcpProbe = deps.tcpProbe ?? defaultTcpProbe;
  const httpProbe = deps.httpProbe ?? defaultHttpProbe;
  const totalMem = deps.totalMem ?? totalmem;
  const diskFree = deps.diskFree ?? defaultDiskFree;
  const now = deps.now ?? ((): Date => new Date());

  const tilesDir = env.TILES_DIR || resolveTilesDir();

  const settled = await Promise.allSettled([
    checkTiles(tilesDir, listDir),
    checkRouting(env, httpProbe),
    checkSearch(env, httpProbe, fileSize),
    checkPosition(env, tcpProbe),
    Promise.resolve(checkMemory(env, totalMem)),
    checkDisk(tilesDir, diskFree),
    Promise.resolve(checkMqtt(env)),
  ]);

  const ids: PreflightCheckId[] = [
    'tiles',
    'routing',
    'search',
    'position',
    'memory',
    'disk',
    'mqtt',
  ];

  const checks: PreflightCheck[] = settled.map((result, i) => {
    if (result.status === 'fulfilled') {
      return result.value;
    }
    const reason = result.reason instanceof Error ? result.reason.message : String(result.reason);
    return {
      id: ids[i],
      label: ids[i],
      status: 'warn',
      severity: 'recommended',
      detail: `Diese Prüfung konnte nicht ausgeführt werden: ${reason}`,
      remedy:
        'Das ist ein Fehler in der Prüfung selbst, nicht zwingend in Ihrer ' +
        'Installation. Bitte melden Sie ihn mit dem obigen Text als Issue.',
    };
  });

  const { status, summary } = summarize(checks);
  return { status, summary, checks, checkedAt: now().toISOString() };
}
