/**
 * Der Weg zu Home Assistant ohne MQTT.
 *
 * ─── WAS HIER WIRKLICH ZAEHLT ───────────────────────────────────────────────
 * Drei Dinge, und jedes hat einen konkreten Anlass:
 *
 *  1. Die Entity-IDs muessen EXAKT die sein, die auch ueber MQTT entstehen --
 *     sonst zeigt das erzeugte Dashboard weiter „Entitaet nicht gefunden",
 *     nur diesmal aus dem umgekehrten Grund.
 *  2. Es darf nicht gegen MQTT geschrieben werden. Zwei Schreiber auf
 *     derselben Entitaet ergaeben ein Flackern, bei dem niemand mehr sagen
 *     kann, welcher Wert gilt.
 *  3. Ein fehlgeschlagener Schreibvorgang darf nicht als erledigt gelten --
 *     sonst fehlt der Wert in Home Assistant, bis er sich zufaellig aendert.
 */

import { describe, it, expect, vi } from 'vitest';
import type { NavState } from '@yapaia/shared';
import { EventBus } from '../bus/index.js';
import { DASHBOARD_ENTITIES } from './dashboard.js';
import {
  HaStatesBridge,
  UNBEKANNT,
  buildHaStates,
  hatSichGeaendert,
  type HaStateWrite,
} from './statesBridge.js';

function navState(overrides: Partial<NavState> = {}): NavState {
  return {
    status: 'navigating',
    route_id: 'r-1',
    next_maneuver: null,
    distance_to_maneuver_m: null,
    distance_remaining_m: 12_340,
    duration_remaining_s: 900,
    eta: '2026-09-09T18:00:00Z',
    speed_kmh: 82.4,
    speed_limit_kmh: 100,
    altitude_m: 214,
    destination: null,
    ...overrides,
  };
}

function findeZustand(writes: HaStateWrite[], entityId: string): HaStateWrite | undefined {
  return writes.find((w) => w.entityId === entityId);
}

describe('welche Entitaeten geschrieben werden', () => {
  it('genau die, die auch das Dashboard sucht -- Befehle ausgenommen', () => {
    // Der eigentliche Punkt: waeren die IDs auch nur leicht anders, stuende
    // im Dashboard weiter „Entitaet nicht gefunden".
    const geschrieben = new Set(
      buildHaStates({ navState: navState(), instruction: null, position: null }).map(
        (w) => w.entityId,
      ),
    );
    const befehle = new Set(['stop', 'pause', 'resume', 'profile']);
    for (const eintrag of DASHBOARD_ENTITIES) {
      const id = `${eintrag.domain}.${eintrag.objectId}`;
      if (befehle.has(eintrag.schluessel)) {
        // Ueber diesen Weg kann eine Entitaet nichts entgegennehmen; sie
        // waere eine tote Schaltflaeche.
        expect(geschrieben.has(id), `${id} sollte NICHT geschrieben werden`).toBe(false);
      } else {
        expect(geschrieben.has(id), `${id} fehlt`).toBe(true);
      }
    }
  });

  it('schreibt die Position nur, wenn es eine gibt', () => {
    const ohne = buildHaStates({ navState: null, instruction: null, position: null });
    expect(findeZustand(ohne, 'device_tracker.yapaja_vehicle')).toBeUndefined();

    const mit = buildHaStates({
      navState: null,
      instruction: null,
      position: { lat: 49.3, lon: 8.2, accuracy: 5, timestamp: 0, source: 'browser' } as never,
    });
    expect(findeZustand(mit, 'device_tracker.yapaja_vehicle')?.attributes).toMatchObject({
      latitude: 49.3,
      longitude: 8.2,
      gps_accuracy: 5,
      source_type: 'gps',
    });
  });
});

describe('die Werte selbst', () => {
  const writes = buildHaStates({ navState: navState(), instruction: null, position: null });

  it('Tempo, Tempolimit und Hoehe als Zahl mit Einheit', () => {
    expect(findeZustand(writes, 'sensor.yapaja_speed')).toMatchObject({
      state: '82',
      attributes: expect.objectContaining({ unit_of_measurement: 'km/h', device_class: 'speed' }),
    });
    expect(findeZustand(writes, 'sensor.yapaja_speed_limit')?.state).toBe('100');
    expect(findeZustand(writes, 'sensor.yapaja_altitude')?.state).toBe('214');
  });

  it('die Reststrecke in Kilometern -- wie in der MQTT-Fassung', () => {
    // Dort rechnet die Vorlage `m / 1000 | round(2)`; beide Wege muessen
    // denselben Wert zeigen, sonst haengt die Anzeige vom Uebertragungsweg ab.
    expect(findeZustand(writes, 'sensor.yapaja_distance_remaining')?.state).toBe('12.34');
  });

  it('„zu schnell" nur, wenn beide Werte bekannt sind', () => {
    expect(findeZustand(writes, 'binary_sensor.yapaja_speeding')?.state).toBe('off');

    const schnell = buildHaStates({
      navState: navState({ speed_kmh: 120 }),
      instruction: null,
      position: null,
    });
    expect(findeZustand(schnell, 'binary_sensor.yapaja_speeding')?.state).toBe('on');

    const ohneLimit = buildHaStates({
      navState: navState({ speed_kmh: 120, speed_limit_kmh: null }),
      instruction: null,
      position: null,
    });
    expect(findeZustand(ohneLimit, 'binary_sensor.yapaja_speeding')?.state).toBe('off');
  });

  it('unbekannte Werte heissen „unknown", nicht „null" oder „NaN"', () => {
    // Ein Sensor mit dem Text „null" sieht in Home Assistant aus wie ein
    // Messwert und ist keiner.
    const leer = buildHaStates({ navState: null, instruction: null, position: null });
    for (const id of ['sensor.yapaja_speed', 'sensor.yapaja_eta', 'sensor.yapaja_altitude']) {
      expect(findeZustand(leer, id)?.state, id).toBe(UNBEKANNT);
    }
    expect(findeZustand(leer, 'sensor.yapaja_nav_state')?.state).toBe('idle');
  });

  it('die Anweisung bringt den Richtungspfeil als Attribut mit', () => {
    // Die Dashboard-Vorlage liest `state_attr(..., 'icon')`.
    const mit = buildHaStates({
      navState: navState(),
      instruction: {
        maneuver: { type: 'turn_right', instruction: 'Rechts abbiegen', street_names: ['Obere Heide'] },
        distance_m: 57,
      } as never,
      position: null,
    });
    expect(findeZustand(mit, 'sensor.yapaja_instruction')).toMatchObject({
      state: 'Rechts abbiegen',
      attributes: expect.objectContaining({ icon: expect.stringContaining('mdi:'), distance_m: 57 }),
    });
    expect(findeZustand(mit, 'sensor.yapaja_instruction_distance')?.state).toBe('57');
  });
});

describe('Aenderungserkennung', () => {
  const a: HaStateWrite = { entityId: 'x', state: '1', attributes: { unit_of_measurement: 'km/h' } };

  it('erkennt den ersten Wert als Aenderung', () => {
    expect(hatSichGeaendert(a, undefined)).toBe(true);
  });

  it('erkennt gleiche Werte als unveraendert', () => {
    expect(hatSichGeaendert(a, { ...a, attributes: { ...a.attributes } })).toBe(false);
  });

  it('sieht auch eine Aenderung NUR in den Attributen', () => {
    // Die Anweisung behaelt ihren Text und aendert nur die Entfernung im
    // Attribut -- ohne diese Pruefung stuende der Pfeil still.
    expect(hatSichGeaendert(a, { ...a, attributes: { unit_of_measurement: 'm' } })).toBe(true);
  });
});

describe('die Bruecke im Betrieb', () => {
  function aufbauen(optionen: { mqttLiefert?: boolean; schreibenKlappt?: boolean } = {}) {
    const bus = new EventBus();
    const geschrieben: HaStateWrite[] = [];
    const meldungen: string[] = [];
    let mqtt = optionen.mqttLiefert ?? false;
    const bruecke = new HaStatesBridge({
      bus,
      verbindung: () => ({ apiBase: 'http://supervisor/core/api', token: 't' }),
      mqttLiefert: () => mqtt,
      schreibe: async (_v, write) => {
        if (optionen.schreibenKlappt === false) return false;
        geschrieben.push(write);
        return true;
      },
      logger: {
        info: (msg) => meldungen.push(msg),
        warn: (msg) => meldungen.push(msg),
      },
      // Kein echter Takt im Test -- `takt()` wird von Hand aufgerufen.
      setIntervalImpl: () => 1,
      clearIntervalImpl: () => undefined,
    });
    return {
      bus,
      bruecke,
      geschrieben,
      meldungen,
      setzeMqtt: (wert: boolean) => {
        mqtt = wert;
      },
    };
  }

  it('schreibt, was auf dem Bus ankommt', async () => {
    const a = aufbauen();
    a.bus.publish('nav/state', navState());
    await a.bruecke.takt(0);
    expect(a.geschrieben.find((w) => w.entityId === 'sensor.yapaja_speed')?.state).toBe('82');
    a.bruecke.dispose();
  });

  it('schreibt beim zweiten Takt nur noch, was sich geaendert hat', async () => {
    const a = aufbauen();
    a.bus.publish('nav/state', navState());
    await a.bruecke.takt(0);
    const ersteRunde = a.geschrieben.length;
    expect(ersteRunde).toBeGreaterThan(5);

    a.geschrieben.length = 0;
    await a.bruecke.takt(1000);
    expect(a.geschrieben).toHaveLength(0);

    a.bus.publish('nav/state', navState({ speed_kmh: 90 }));
    await a.bruecke.takt(2000);
    expect(a.geschrieben.map((w) => w.entityId)).toEqual(['sensor.yapaja_speed']);
    a.bruecke.dispose();
  });

  it('schreibt turnusmaessig alles noch einmal -- gegen den HA-Neustart', async () => {
    // Ohne das waere eine Entitaet, die sich selten aendert (Ziel,
    // Fahrzustand), nach einem Neustart von Home Assistant auf unbestimmte
    // Zeit weg: bei stehendem Fahrzeug also fuer immer.
    const a = aufbauen();
    a.bus.publish('nav/state', navState());
    await a.bruecke.takt(0);
    const alle = a.geschrieben.length;

    a.geschrieben.length = 0;
    await a.bruecke.takt(5 * 60_000);
    expect(a.geschrieben).toHaveLength(alle);
    a.bruecke.dispose();
  });

  it('schreibt NICHT, solange MQTT die Entitaeten liefert', async () => {
    const a = aufbauen({ mqttLiefert: true });
    a.bus.publish('nav/state', navState());
    await a.bruecke.takt(0);
    expect(a.geschrieben).toHaveLength(0);
    expect(a.meldungen.some((m) => m.includes('haelt sich zurueck'))).toBe(true);
    a.bruecke.dispose();
  });

  it('uebernimmt, wenn MQTT ausfaellt', async () => {
    const a = aufbauen({ mqttLiefert: true });
    a.bus.publish('nav/state', navState());
    await a.bruecke.takt(0);
    expect(a.geschrieben).toHaveLength(0);

    a.setzeMqtt(false);
    await a.bruecke.takt(1000);
    expect(a.geschrieben.length).toBeGreaterThan(5);
    expect(a.meldungen.some((m) => m.includes('uebernimmt'))).toBe(true);
    a.bruecke.dispose();
  });

  it('merkt sich einen fehlgeschlagenen Schreibvorgang NICHT als erledigt', async () => {
    // Sonst faellt der Wert bis zur naechsten Aenderung aus -- und genau die
    // Werte, die selten wechseln, kaemen nie wieder.
    const a = aufbauen({ schreibenKlappt: false });
    a.bus.publish('nav/state', navState());
    await a.bruecke.takt(0);

    let versuche = 0;
    const b = new HaStatesBridge({
      bus: a.bus,
      verbindung: () => ({ apiBase: 'x', token: 't' }),
      mqttLiefert: () => false,
      schreibe: async () => {
        versuche += 1;
        return false;
      },
      logger: { info: () => undefined, warn: () => undefined },
      setIntervalImpl: () => 1,
      clearIntervalImpl: () => undefined,
    });
    a.bus.publish('nav/state', navState());
    await b.takt(0);
    const ersteVersuche = versuche;
    await b.takt(1000);
    expect(versuche).toBe(ersteVersuche * 2);
    b.dispose();
    a.bruecke.dispose();
  });

  it('tut nichts ohne HA-Verbindung', async () => {
    const bus = new EventBus();
    const schreibe = vi.fn(async () => true);
    const bruecke = new HaStatesBridge({
      bus,
      verbindung: () => null,
      mqttLiefert: () => false,
      schreibe,
      logger: { info: () => undefined, warn: () => undefined },
      setIntervalImpl: () => 1,
      clearIntervalImpl: () => undefined,
    });
    bus.publish('nav/state', navState());
    await bruecke.takt(0);
    expect(schreibe).not.toHaveBeenCalled();
    bruecke.dispose();
  });

  it('haengt sich beim Herunterfahren wieder vom Bus ab', async () => {
    const a = aufbauen();
    a.bruecke.dispose();
    a.bus.publish('nav/state', navState());
    await a.bruecke.takt(0);
    expect(a.geschrieben).toHaveLength(0);
  });
});
