/* eslint-disable no-undef -- `setInterval`/`clearInterval` sind Standard-Globale
 * in Node 22 (typisiert ueber @types/node); dieselbe Begruendung wie in
 * ha/client.ts. */

/**
 * Der zweite Weg zu Home Assistant: ohne MQTT-Broker.
 *
 * ─── WOFUER ─────────────────────────────────────────────────────────────────
 * Gefragt: „Kannst du bitte die Möglichkeit ha interne Kommunikation
 * hinzufügen? Ohne Mqtt." -- mit dem Ziel, spaeter „per esphome über die ha
 * api oder auch Mqtt auf die Daten zugreifen" zu koennen.
 *
 * Der Anlass war handfest: das fertige Dashboard zeigte in jeder Kachel
 * „Entitaet nicht gefunden", weil es ohne Broker ueberhaupt keine
 * Yapaia-Entitaeten in Home Assistant gab. Der Broker war damit eine
 * Voraussetzung, die nirgends stand.
 *
 * ─── WIE ────────────────────────────────────────────────────────────────────
 * `POST /api/states/<entity_id>` schreibt einen Zustand direkt in Home
 * Assistants Zustandsmaschine -- ueber denselben Supervisor-Zugang, den das
 * Add-on fuer Ansagen und Benachrichtigungen ohnehin hat. Es entstehen
 * dieselben Entity-IDs wie ueber MQTT (`sensor.yapaja_speed` und so fort),
 * lesbar von Automationen, Vorlagen, ESPHome und jedem Dashboard.
 *
 * ─── WAS DIESER WEG NICHT KANN, UND DAS GEHOERT DAZU ────────────────────────
 *  1. KEINE BEFEHLE. Eine so geschriebene Entitaet nimmt nichts entgegen --
 *     Pause/Weiter/Beenden und die Profilauswahl gibt es nur mit MQTT. Das
 *     erzeugte Dashboard laesst diese Kacheln deshalb weg, wenn es die
 *     Entitaeten nicht findet (`dashboard.ts`), statt tote Knoepfe zu zeigen.
 *  2. KEIN GERAET, KEINE REGISTRIERUNG. Die Entitaeten tauchen nicht unter
 *     „Geraete" auf und lassen sich in der Oberflaeche nicht umbenennen.
 *  3. SIE VERSCHWINDEN BEIM NEUSTART von Home Assistant -- bis zum naechsten
 *     Schreiben. Genau dagegen schreibt {@link HaStatesBridge} in Ruhe auch
 *     unveraenderte Werte turnusmaessig noch einmal; ohne das waere eine
 *     Entitaet, die sich selten aendert (das Ziel, der Fahrzustand), nach
 *     jedem HA-Neustart auf unbestimmte Zeit weg.
 *
 * ─── WARUM ER SICH ZURUECKHAELT, WENN MQTT LAEUFT ───────────────────────────
 * Beide Wege schreiben dieselben Entity-IDs. Liefen sie gleichzeitig, ueber-
 * schrieben sie sich gegenseitig, und niemand koennte mehr sagen, welcher
 * Wert gilt -- eine Anzeige, die flackert, ist schlimmer als eine, die fehlt.
 * Solange die MQTT-Bruecke verbunden ist, schreibt dieser Kanal deshalb
 * nichts. Faellt der Broker aus, uebernimmt er, und die Werte laufen weiter.
 */

import type { NavState, NavInstructionPayload, Position } from '@yapaia/shared';
import type { EventBus } from '../bus/index.js';
import type { HaConnection } from './config.js';
import { buildSpeedPayload, maneuverIcon } from '../mqtt/mapping.js';

/** Ein Zustand, wie ihn Home Assistant entgegennimmt. */
export interface HaStateWrite {
  entityId: string;
  state: string;
  attributes: Record<string, unknown>;
}

/** Was der Core gerade weiss. */
export interface YapaiaZustand {
  navState: NavState | null;
  instruction: NavInstructionPayload | null;
  position: Position | null;
}

/** Der Anzeigename des Geraets -- dieselbe Schreibweise wie bei der Discovery. */
const GERAET = 'Yapaia Go';

/** Home Assistant kennt fuer „weiss ich nicht" genau dieses Wort. */
export const UNBEKANNT = 'unknown';

function zahl(wert: number | null | undefined, stellen = 0): string {
  if (wert === null || wert === undefined || !Number.isFinite(wert)) return UNBEKANNT;
  return wert.toFixed(stellen);
}

/**
 * Alle Zustaende, die dieser Kanal schreibt -- rein aus dem, was der Core
 * weiss. Keine Netzwerkzugriffe, damit sich jeder einzelne Wert pruefen
 * laesst.
 */
export function buildHaStates(zustand: YapaiaZustand): HaStateWrite[] {
  const { navState, instruction, position } = zustand;
  const tempo = navState ? buildSpeedPayload(navState) : null;
  const schreibt: HaStateWrite[] = [];

  const dazu = (
    entityId: string,
    state: string,
    name: string,
    attribute: Record<string, unknown> = {},
  ): void => {
    schreibt.push({
      entityId,
      state,
      attributes: { friendly_name: `${GERAET} ${name}`, ...attribute },
    });
  };

  dazu('sensor.yapaja_speed', zahl(tempo?.speed_kmh ?? null), 'Speed', {
    unit_of_measurement: 'km/h',
    device_class: 'speed',
    state_class: 'measurement',
    icon: 'mdi:speedometer',
  });
  dazu('sensor.yapaja_speed_limit', zahl(tempo?.speed_limit_kmh ?? null), 'Speed Limit', {
    unit_of_measurement: 'km/h',
    device_class: 'speed',
    state_class: 'measurement',
    icon: 'mdi:speedometer-medium',
  });
  dazu('binary_sensor.yapaja_speeding', tempo?.speeding ? 'on' : 'off', 'Speeding', {
    device_class: 'safety',
  });
  dazu('sensor.yapaja_eta', navState?.eta ?? UNBEKANNT, 'ETA', {
    device_class: 'timestamp',
    icon: 'mdi:clock-outline',
  });
  dazu(
    'sensor.yapaja_distance_remaining',
    navState?.distance_remaining_m === null || navState?.distance_remaining_m === undefined
      ? UNBEKANNT
      : (navState.distance_remaining_m / 1000).toFixed(2),
    'Distance Remaining',
    {
      unit_of_measurement: 'km',
      device_class: 'distance',
      state_class: 'measurement',
      icon: 'mdi:map-marker-distance',
    },
  );
  dazu(
    'sensor.yapaja_instruction',
    instruction?.maneuver.instruction ?? UNBEKANNT,
    'Instruction',
    instruction
      ? {
          // Dieselben Zusatzangaben wie ueber MQTT -- die Vorlage des
          // Dashboards liest `icon` fuer den Richtungspfeil.
          type: instruction.maneuver.type,
          street_names: instruction.maneuver.street_names,
          distance_m: instruction.distance_m,
          icon: maneuverIcon(instruction.maneuver.type),
        }
      : { icon: 'mdi:navigation' },
  );
  dazu('sensor.yapaja_instruction_distance', zahl(instruction?.distance_m ?? null), 'Instruction Distance', {
    unit_of_measurement: 'm',
    device_class: 'distance',
    state_class: 'measurement',
  });
  dazu('sensor.yapaja_altitude', zahl(navState?.altitude_m ?? null), 'Altitude', {
    unit_of_measurement: 'm',
    device_class: 'distance',
    state_class: 'measurement',
    icon: 'mdi:altimeter',
  });
  dazu('sensor.yapaja_nav_state', navState?.status ?? 'idle', 'Nav State', {
    icon: 'mdi:navigation-variant',
  });
  dazu(
    'sensor.yapaja_destination',
    navState?.destination?.name ?? UNBEKANNT,
    'Destination',
    navState?.destination
      ? {
          lat: navState.destination.latlng.lat,
          lon: navState.destination.latlng.lon,
          icon: 'mdi:flag-checkered',
        }
      : { icon: 'mdi:flag-checkered' },
  );

  if (position) {
    // `device_tracker` traegt die Position in den Attributen; der Zustand ist
    // die Zone. „not_home" ist die ehrliche Vorgabe -- ob das Fahrzeug in
    // einer Zone steht, entscheidet Home Assistant selbst nicht fuer
    // fremdgeschriebene Tracker, und „home" zu behaupten waere geraten.
    schreibt.push({
      entityId: 'device_tracker.yapaja_vehicle',
      state: 'not_home',
      attributes: {
        friendly_name: `${GERAET} Vehicle`,
        source_type: 'gps',
        latitude: position.lat,
        longitude: position.lon,
        gps_accuracy: position.accuracy ?? 0,
      },
    });
  }

  return schreibt;
}

/** Ob sich ein Zustand gegenueber dem zuletzt geschriebenen geaendert hat. */
export function hatSichGeaendert(neu: HaStateWrite, alt: HaStateWrite | undefined): boolean {
  if (!alt) return true;
  if (neu.state !== alt.state) return true;
  return JSON.stringify(neu.attributes) !== JSON.stringify(alt.attributes);
}

/**
 * Wie oft geschrieben wird. Nicht bei jeder Meldung: der Fahrzustand kommt im
 * Sekundentakt, und jede Entitaet einzeln waere ein Dutzend Aufrufe pro
 * Sekunde fuer eine Anzeige, die niemand schneller liest.
 */
export const SCHREIB_INTERVALL_MS = 1_000;

/**
 * Wie oft ALLES noch einmal geschrieben wird, auch unveraendert.
 *
 * Gegen den Neustart von Home Assistant: dabei verliert die Zustandsmaschine
 * jede von aussen geschriebene Entitaet. Ohne diese Wiederholung waere das
 * Ziel oder der Fahrzustand danach so lange weg, bis sich der Wert zufaellig
 * einmal aendert -- bei stehendem Fahrzeug also nie.
 */
export const AUFFRISCH_INTERVALL_MS = 5 * 60_000;

export interface HaStatesBridgeDeps {
  bus: EventBus;
  /** Die HA-Verbindung, oder `null`, solange keine konfiguriert ist. */
  verbindung: () => HaConnection | null;
  /** Ob die MQTT-Bruecke die Entitaeten gerade selbst liefert. */
  mqttLiefert: () => boolean;
  /** Schreibt EINEN Zustand. Gibt zurueck, ob es geklappt hat. */
  schreibe: (verbindung: HaConnection, write: HaStateWrite) => Promise<boolean>;
  logger: { info: (msg: string, meta?: Record<string, unknown>) => void; warn: (msg: string, meta?: Record<string, unknown>) => void };
  intervallMs?: number;
  auffrischMs?: number;
  setIntervalImpl?: (fn: () => void, ms: number) => unknown;
  clearIntervalImpl?: (handle: unknown) => void;
}

export class HaStatesBridge {
  private readonly deps: HaStatesBridgeDeps;
  private readonly unsubscribers: Array<() => void> = [];
  private zustand: YapaiaZustand = { navState: null, instruction: null, position: null };
  private zuletzt = new Map<string, HaStateWrite>();
  private timer: unknown = null;
  private naechsteAuffrischung = 0;
  private mqttGemeldet = false;
  private entsorgt = false;

  constructor(deps: HaStatesBridgeDeps) {
    this.deps = deps;
    this.unsubscribers.push(
      deps.bus.subscribe('nav/state', (state) => {
        this.zustand.navState = state as NavState;
      }),
      deps.bus.subscribe('nav/instruction', (payload) => {
        this.zustand.instruction = payload as NavInstructionPayload;
      }),
      deps.bus.subscribe('pos/update', (pos) => {
        const p = pos as Position;
        if (typeof p?.lat === 'number' && typeof p?.lon === 'number') this.zustand.position = p;
      }),
    );

    const setIntervalFn = deps.setIntervalImpl ?? ((fn, ms) => setInterval(fn, ms));
    this.timer = setIntervalFn(() => {
      void this.takt();
    }, deps.intervallMs ?? SCHREIB_INTERVALL_MS);
  }

  /** Ein Schreibtakt. Wirft nie -- eine stille Anzeige ist besser als ein
   *  Kanal, der die Navigation mitreisst. */
  async takt(jetzt: number = Date.now()): Promise<void> {
    // Eine abgehaengte Bruecke schreibt nichts mehr. Ohne diese Zeile koennte
    // ein Takt, der beim Herunterfahren gerade unterwegs ist, noch Zustaende
    // in ein Home Assistant schreiben, von dem sich der Core schon
    // verabschiedet hat.
    if (this.entsorgt) return;
    const verbindung = this.deps.verbindung();
    if (!verbindung) return;

    if (this.deps.mqttLiefert()) {
      // Einmal sagen, nicht jede Sekunde.
      if (!this.mqttGemeldet) {
        this.mqttGemeldet = true;
        this.deps.logger.info(
          'HA-interner Kanal: MQTT liefert die Entitaeten -- der interne Kanal haelt sich zurueck.',
        );
      }
      return;
    }
    if (this.mqttGemeldet) {
      this.mqttGemeldet = false;
      this.deps.logger.info('HA-interner Kanal: MQTT liefert nicht mehr -- der interne Kanal uebernimmt.');
    }

    const alleNeu = jetzt >= this.naechsteAuffrischung;
    if (alleNeu) this.naechsteAuffrischung = jetzt + (this.deps.auffrischMs ?? AUFFRISCH_INTERVALL_MS);

    for (const write of buildHaStates(this.zustand)) {
      if (!alleNeu && !hatSichGeaendert(write, this.zuletzt.get(write.entityId))) continue;
      const ok = await this.deps.schreibe(verbindung, write);
      // Nur merken, was wirklich angekommen ist -- sonst gilt ein
      // fehlgeschlagener Schreibvorgang als erledigt und der Wert fehlt in
      // Home Assistant, bis er sich das naechste Mal aendert.
      if (ok) this.zuletzt.set(write.entityId, write);
    }
  }

  dispose(): void {
    this.entsorgt = true;
    for (const unsub of this.unsubscribers) unsub();
    this.unsubscribers.length = 0;
    if (this.timer !== null) {
      const clearIntervalFn = this.deps.clearIntervalImpl ?? ((h) => clearInterval(h as never));
      clearIntervalFn(this.timer);
      this.timer = null;
    }
  }
}
