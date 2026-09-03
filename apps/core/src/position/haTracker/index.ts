/**
 * Position aus einer Home-Assistant-`device_tracker`-Entität (Backlog B-05).
 *
 * ─── WOZU DIESE QUELLE ──────────────────────────────────────────────────────
 * Die naheliegende Quelle für ein Telefon, ein Tablet oder ein
 * Android-Autoradio ist der Browser (`browserSource.ts`). Der Browser gibt den
 * GPS-Sensor aber NUR in einem sicheren Kontext frei — Home Assistant über
 * `http://…:8123` erreicht, und die Ortung ist gesperrt, egal was Yapaja tut.
 * Genau dieser Fall liegt im Betrieb vor (siehe `docs/gps-endgeraete.md`).
 *
 * Die Home-Assistant-Companion-App umgeht das vollständig: sie meldet an Home
 * Assistant, nicht an den Browser. Dieses Add-on darf diese Zustände mit dem
 * ohnehin vorhandenen `homeassistant_api`-Zugang lesen. Zusätzlich löst sie
 * ein zweites Problem: ein Browser-Tab wird bei gesperrtem Bildschirm von
 * Safari eingefroren und von Chrome-Android gedrosselt — `watchPosition`
 * liefert dann nichts mehr. Die App ist für genau diesen Fall gebaut.
 *
 * ─── UND WARUM SIE TROTZDEM UNTER DEM BROWSER STEHT ─────────────────────────
 * Sie meldet in INTERVALLEN, nicht fortlaufend. Für eine Abbiegeansage in
 * 200 m ist das zu träge. Sie ist die Quelle, die es GIBT, wenn der Browser
 * keine liefert — nicht die, die einen laufenden Browser-Fix ersetzt. Die
 * Prioritätskette lautet deshalb `gpsd > browser > ha_tracker > simulator`.
 *
 * ─── WAS HIER BEWUSST NICHT PASSIERT ────────────────────────────────────────
 * Kein Fehler nach außen. Ein ausgefallenes, langsames oder falsch
 * konfiguriertes Home Assistant darf die Navigation nie blockieren — dieselbe
 * harte Regel wie beim Ausgabekanal (`ha/client.ts`). Fällt die Abfrage aus,
 * bleibt die Quelle einfach inaktiv, und `PositionService` fällt auf die
 * nächste Priorität zurück (ADR-007).
 */

import { checkPosition, type Position } from '@yapaja/shared';
import { fetchHaStates, type HaClientLogger, type HaEntityState } from '../../ha/client.js';
import type { HaConnection } from '../../ha/config.js';
import { PlausibilityGuard } from '../guard.js';
import type { PositionService, PositionSource } from '../service.js';

/* eslint-disable no-undef -- setInterval/clearInterval sind Node-Globals;
 * gleiche Begruendung wie in ../service.ts. */

/** Wie oft der Zustand abgefragt wird. Die Companion App meldet je nach
 *  Einstellung alle paar Sekunden bis Minuten; oefter zu fragen als sie
 *  meldet, kostet nur Anfragen und bringt keine neue Position. */
export const DEFAULT_POLL_INTERVAL_MS = 5000;

/** Ohne `gps_accuracy` nimmt HA keine Genauigkeit an. 50 m ist ein
 *  konservativer Platzhalter, der einen Fix nicht faelschlich als praezise
 *  ausweist (unter 100 m, also nicht automatisch „ungenau"). */
export const ASSUMED_ACCURACY_M = 50;

/**
 * Aelter als das, und der Zustand ist keine Position mehr, sondern eine
 * Erinnerung.
 *
 * Die Companion App meldet in Intervallen und schweigt, wenn das Telefon
 * keinen Empfang hat. Ein Zustand von vor einer Viertelstunde als aktuelle
 * Position auszugeben, waere die gefaehrlichste Art von Falschaussage in
 * einer Navigation: sie sieht aus wie eine Messung. Lieber KEINE Position --
 * dann greift die GPS-Verlust-Behandlung (W-01), die es dafuer gibt.
 */
export const MAX_FIX_AGE_MS = 5 * 60 * 1000;

export interface HaTrackerSourceOptions {
  positionService: PositionService;
  /** Wie das Add-on Home Assistant erreicht; `null` = nicht konfiguriert. */
  resolveConnection: () => HaConnection | null;
  /** Entity-ID, z. B. `device_tracker.mein_telefon`. Leer = Quelle aus,
   *  ausser `autoSelect` ist gesetzt. */
  entityId: string;
  /**
   * Ohne ausdrueckliche Entity-ID selbst suchen (`gps_source: ha_tracker`).
   *
   * Der Grund: eine Entity-ID ist nichts, was man weiss. Sie steht in Home
   * Assistant unter Entwicklerwerkzeuge -> Zustaende, und wer sie dort
   * abschreiben muss, bevor irgendetwas funktioniert, hat eine Einrichtung
   * vor sich, die aus einem Textfeld und einem Ratespiel besteht. In der
   * ueberwaeltigenden Mehrheit der Installationen gibt es genau EINEN
   * `device_tracker` mit Koordinaten -- dann gibt es auch nichts zu waehlen.
   *
   * Gibt es MEHRERE, wird hier bewusst NICHT geraten: der zweite Tracker
   * koennte das Telefon einer anderen Person sein, und die Navigation wuerde
   * ihr stillschweigend folgen. Dann bleibt die Quelle inaktiv und nennt im
   * Protokoll die Auswahl.
   */
  autoSelect?: boolean;
  logger: HaClientLogger;
  pollIntervalMs?: number;
  /** Injizierbar fuer Tests. */
  fetchStates?: typeof fetchHaStates;
}

/** Alle `device_tracker.*`-Zustaende, die tatsaechlich Koordinaten tragen.
 *  Ein Tracker ohne `latitude`/`longitude` (etwa einer, der nur „home"/„not
 *  home" per WLAN meldet) ist als Positionsquelle wertlos -- ihn anzubieten
 *  waere ein Knopf, der sicher nichts tut. */
export function listGpsTrackers(states: HaEntityState[]): string[] {
  return states
    .filter(
      (entry) =>
        entry.entity_id.startsWith('device_tracker.') &&
        typeof entry.attributes.latitude === 'number' &&
        typeof entry.attributes.longitude === 'number',
    )
    .map((entry) => entry.entity_id)
    .sort();
}

/**
 * Baut aus einem HA-Zustand einen `Position`-Fix, oder `null`, wenn er keine
 * brauchbaren Koordinaten traegt.
 */
export function toPosition(state: HaEntityState, now: () => Date = () => new Date()): Position | null {
  const { latitude, longitude, gps_accuracy: accuracy, altitude, speed, course } = state.attributes;
  if (typeof latitude !== 'number' || typeof longitude !== 'number') {
    return null;
  }

  // ─── DER ZEITSTEMPEL IST DER VON HOME ASSISTANT, NICHT UNSERER ────────────
  // Erst stand hier `now()`. Das war bequem und falsch: ein Zustand, den die
  // App vor zehn Minuten gemeldet hat, haette sich damit als brandaktuelle
  // Messung ausgegeben. Genau daran haette auch der Sprungfilter nichts
  // gemerkt -- er rechnet die Geschwindigkeit aus der Differenz ZWEIER
  // Zeitstempel, und zwei erfundene „jetzt" liegen immer dicht beieinander.
  //
  // `last_updated` ist der Zeitpunkt, zu dem Home Assistant den Zustand
  // zuletzt gesehen hat. Fehlt er, bleibt nur `now()` -- dann greift
  // wenigstens die Altersgrenze in `poll()` nicht faelschlich.
  const reported = typeof state.last_updated === 'string' ? Date.parse(state.last_updated) : NaN;
  const ts = Number.isFinite(reported) ? new Date(reported) : now();

  // Die Companion App liefert `speed` in m/s und `course` in Grad, aber nicht
  // immer und teilweise als -1 („unbekannt"). Nur uebernehmen, was plausibel
  // ist -- ein erfundener Kurs waere schlimmer als gar keiner, weil die
  // Kartenausrichtung ihm folgen wuerde.
  const speedMs = typeof speed === 'number' && speed >= 0 ? speed : null;
  const heading = typeof course === 'number' && course >= 0 && course <= 360 ? course : null;
  const alt = typeof altitude === 'number' ? altitude : null;
  const accuracyM = typeof accuracy === 'number' && accuracy >= 0 ? accuracy : ASSUMED_ACCURACY_M;

  return {
    lat: latitude,
    lon: longitude,
    alt,
    speed: speedMs,
    heading,
    accuracy: accuracyM,
    source: 'ha_tracker',
    fix: alt !== null ? '3d' : '2d',
    ts: ts.toISOString(),
  };
}

export class HaTrackerSource implements PositionSource {
  readonly name = 'ha_tracker' as const;

  private readonly opts: HaTrackerSourceOptions;
  private readonly guard = new PlausibilityGuard();
  private timer: ReturnType<typeof setInterval> | null = null;
  /** Damit ein dauerhaft fehlender Tracker das Protokoll nicht vollschreibt. */
  private missingLogged = false;
  /** Dasselbe fuer die automatische Auswahl: einmal sagen, was gefunden
   *  wurde, nicht alle fuenf Sekunden. */
  private autoLogged = false;
  /** Die zuletzt automatisch gewaehlte Entitaet -- nur fuers Protokoll, damit
   *  ein Wechsel (Tracker verschwindet, anderer kommt) wieder auftaucht. */
  private autoPicked: string | null = null;

  constructor(opts: HaTrackerSourceOptions) {
    this.opts = opts;
  }

  /** Ob diese Quelle ueberhaupt etwas tun kann: HA erreichbar konfiguriert,
   *  und entweder eine Entity-ID gesetzt ODER die Erlaubnis, selbst zu
   *  suchen. */
  isConfigured(): boolean {
    if (this.opts.resolveConnection() === null) {
      return false;
    }
    return this.opts.entityId.trim().length > 0 || this.opts.autoSelect === true;
  }

  /**
   * Welche Entitaet dieser Durchgang lesen soll -- die konfigurierte, oder
   * die einzige, die in Frage kommt. `null` heisst „diesmal keine"; das ist
   * kein Fehler, sondern der Zustand vor der Einrichtung.
   */
  private resolveEntityId(states: HaEntityState[]): string | null {
    const configured = this.opts.entityId.trim();
    if (configured.length > 0) {
      return configured;
    }
    if (this.opts.autoSelect !== true) {
      return null;
    }

    const candidates = listGpsTrackers(states);
    if (candidates.length === 1) {
      const picked = candidates[0];
      if (this.autoPicked !== picked) {
        this.autoPicked = picked;
        this.autoLogged = false;
      }
      if (!this.autoLogged) {
        this.autoLogged = true;
        this.opts.logger.info(
          'ha_tracker: Entitaet automatisch gewaehlt (genau eine mit Koordinaten gefunden)',
          { entityId: picked },
        );
      }
      return picked;
    }

    this.autoPicked = null;
    if (!this.autoLogged) {
      this.autoLogged = true;
      if (candidates.length === 0) {
        this.opts.logger.warn(
          'ha_tracker: kein device_tracker mit Koordinaten in Home Assistant gefunden -- ' +
            'Quelle bleibt inaktiv. Companion App installieren und die Ortung erlauben.',
        );
      } else {
        this.opts.logger.warn(
          'ha_tracker: mehrere device_tracker mit Koordinaten gefunden -- es wird KEINER ' +
            'geraten. Bitte in der Add-on-Konfiguration unter „ha_device_tracker" ' +
            'eintragen, welcher gemeint ist.',
          { verfuegbar: candidates },
        );
      }
    }
    return null;
  }

  start(): void {
    if (this.timer || !this.isConfigured()) {
      return;
    }
    const interval = this.opts.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;
    this.timer = setInterval(() => void this.poll(), interval);
    this.timer.unref?.();
    void this.poll();
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  /** Ein Abfragedurchgang. Oeffentlich, damit Tests ihn gezielt ausloesen
   *  koennen, statt auf einen Timer zu warten. */
  async poll(): Promise<void> {
    const connection = this.opts.resolveConnection();
    if (!connection) {
      return;
    }
    const fetchStates = this.opts.fetchStates ?? fetchHaStates;
    const states = await fetchStates(connection, { logger: this.opts.logger });
    const wanted = this.resolveEntityId(states);
    if (wanted === null) {
      return;
    }
    const state = states.find((entry) => entry.entity_id === wanted);
    if (!state) {
      if (!this.missingLogged) {
        this.missingLogged = true;
        this.opts.logger.warn(
          'ha_tracker: konfigurierte Entitaet nicht gefunden -- Quelle bleibt inaktiv',
          { entityId: wanted, verfuegbar: listGpsTrackers(states) },
        );
      }
      return;
    }
    this.missingLogged = false;

    const position = toPosition(state);
    if (!position) {
      return;
    }
    // Zu alt ist dasselbe wie „keine Position" -- siehe MAX_FIX_AGE_MS.
    const ageMs = Date.now() - Date.parse(position.ts);
    if (Number.isFinite(ageMs) && ageMs > MAX_FIX_AGE_MS) {
      return;
    }
    // Wertebereiche zuerst: ein Zustand aus einer fremden Anwendung ist
    // ungeprueft, genau wie ein Fix aus dem Netz.
    if (!checkPosition(position).ok) {
      return;
    }
    // Und dann derselbe Sprungfilter wie beim USB-Empfaenger: ein Tracker,
    // der nach einer Funkluecke 300 km weiter wieder auftaucht, ist genau
    // sein Fall (W-02).
    const verdict = this.guard.evaluate(position);
    if (!verdict.accept || !verdict.position) {
      return;
    }
    this.opts.positionService.pushFix('ha_tracker', verdict.position);
  }
}
