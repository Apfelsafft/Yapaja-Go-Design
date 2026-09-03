/**
 * Tests für die Positionsquelle „Home-Assistant-Companion-App" (B-05).
 *
 * Der Weg, der ohne HTTPS funktioniert — und damit für viele Aufbauten der
 * einzige, der überhaupt eine Position liefert: der Browser gibt seinen
 * GPS-Sensor nur in einem sicheren Kontext frei, und Home Assistant läuft in
 * vielen Installationen über einfaches HTTP.
 *
 * Kein Test spricht mit einem echten Home Assistant; `fetchStates` kommt als
 * Abhängigkeit herein.
 */

import { describe, it, expect, vi } from 'vitest';
import { EventBus } from '../../bus/index.js';
import { PositionService } from '../service.js';
import type { HaEntityState } from '../../ha/client.js';
import {
  HaTrackerSource,
  listGpsTrackers,
  toPosition,
  ASSUMED_ACCURACY_M,
  MAX_FIX_AGE_MS,
} from './index.js';

const CONNECTION = { apiBase: 'http://supervisor/core/api', token: 'geheim' };

const silentLogger = { info: () => undefined, warn: () => undefined, error: () => undefined };

function trackerState(overrides: Partial<HaEntityState> = {}): HaEntityState {
  return {
    entity_id: 'device_tracker.mein_telefon',
    state: 'not_home',
    attributes: { latitude: 47.141, longitude: 9.521, gps_accuracy: 12 },
    last_updated: new Date().toISOString(),
    ...overrides,
  };
}

function makeSource(
  states: HaEntityState[],
  opts: {
    entityId?: string;
    connection?: typeof CONNECTION | null;
    autoSelect?: boolean;
    logger?: typeof silentLogger;
  } = {},
): { source: HaTrackerSource; service: PositionService } {
  const service = new PositionService({ bus: new EventBus(), checkIntervalMs: 10_000 });
  const source = new HaTrackerSource({
    positionService: service,
    resolveConnection: () => (opts.connection === undefined ? CONNECTION : opts.connection),
    entityId: opts.entityId ?? 'device_tracker.mein_telefon',
    autoSelect: opts.autoSelect,
    logger: opts.logger ?? silentLogger,
    fetchStates: async () => states,
  });
  return { source, service };
}

describe('listGpsTrackers', () => {
  it('nennt nur device_tracker MIT Koordinaten', () => {
    // Ein Tracker, der nur „home"/„not home" per WLAN meldet, taugt nicht als
    // Positionsquelle. Ihn anzubieten waere ein Knopf, der sicher nichts tut.
    const states: HaEntityState[] = [
      trackerState({ entity_id: 'device_tracker.mit_gps' }),
      trackerState({ entity_id: 'device_tracker.nur_wlan', attributes: { source_type: 'router' } }),
      trackerState({ entity_id: 'sensor.irgendwas' }),
    ];
    expect(listGpsTrackers(states)).toEqual(['device_tracker.mit_gps']);
  });

  it('liefert eine leere Liste, wenn gar nichts passt', () => {
    expect(listGpsTrackers([])).toEqual([]);
  });
});

describe('toPosition', () => {
  it('übernimmt Koordinaten, Genauigkeit und markiert die Quelle', () => {
    const pos = toPosition(trackerState());
    expect(pos?.lat).toBe(47.141);
    expect(pos?.lon).toBe(9.521);
    expect(pos?.accuracy).toBe(12);
    expect(pos?.source).toBe('ha_tracker');
  });

  it('ohne Koordinaten gibt es keinen Fix', () => {
    expect(toPosition(trackerState({ attributes: { source_type: 'router' } }))).toBeNull();
  });

  it('nimmt eine konservative Genauigkeit an, wenn HA keine meldet', () => {
    const pos = toPosition(trackerState({ attributes: { latitude: 47, longitude: 9 } }));
    expect(pos?.accuracy).toBe(ASSUMED_ACCURACY_M);
  });

  it('verwirft einen unbekannten Kurs (-1), statt ihn zu übernehmen', () => {
    // Die Companion App meldet -1 fuer „unbekannt". Ein erfundener Kurs waere
    // schlimmer als gar keiner: die Kartenausrichtung wuerde ihm folgen.
    const pos = toPosition(
      trackerState({ attributes: { latitude: 47, longitude: 9, course: -1, speed: -1 } }),
    );
    expect(pos?.heading).toBeNull();
    expect(pos?.speed).toBeNull();
  });

  it('übernimmt einen plausiblen Kurs und eine plausible Geschwindigkeit', () => {
    const pos = toPosition(
      trackerState({ attributes: { latitude: 47, longitude: 9, course: 90, speed: 13.5 } }),
    );
    expect(pos?.heading).toBe(90);
    expect(pos?.speed).toBe(13.5);
  });
});

describe('HaTrackerSource', () => {
  it('reicht einen Fix der konfigurierten Entität an den PositionService', async () => {
    const { source, service } = makeSource([trackerState()]);
    await source.poll();
    const last = service.getLast();
    expect(last?.source).toBe('ha_tracker');
    expect(last?.lat).toBe(47.141);
  });

  it('ignoriert andere Entitäten', async () => {
    const { source, service } = makeSource([trackerState({ entity_id: 'device_tracker.fremd' })]);
    await source.poll();
    expect(service.getLast()).toBeNull();
  });

  it('ist ohne konfigurierte Entität nicht eingerichtet und tut nichts', async () => {
    const { source, service } = makeSource([trackerState()], { entityId: '' });
    expect(source.isConfigured()).toBe(false);
    source.start();
    await source.poll();
    expect(service.getLast()).toBeNull();
  });

  it('ist ohne HA-Verbindung nicht eingerichtet', () => {
    const { source } = makeSource([trackerState()], { connection: null });
    expect(source.isConfigured()).toBe(false);
  });

  // ─── Automatische Wahl (`gps_source: ha_tracker` ohne Entity-ID) ─────────
  // Eine Entity-ID ist nichts, was man weiß. Bis 0.3.0 war sie Pflicht, und
  // sie stand nur in Home Assistant unter Entwicklerwerkzeuge → Zustände —
  // die Einrichtung bestand damit aus einem leeren Textfeld und Raten.
  describe('automatische Wahl', () => {
    it('wählt die einzige Entität mit Koordinaten selbst', async () => {
      const { source, service } = makeSource(
        [
          trackerState({ entity_id: 'device_tracker.telefon' }),
          trackerState({ entity_id: 'device_tracker.nur_wlan', attributes: { source_type: 'router' } }),
        ],
        { entityId: '', autoSelect: true },
      );
      expect(source.isConfigured()).toBe(true);
      await source.poll();
      expect(service.getLast()?.source).toBe('ha_tracker');
    });

    // Der zweite Tracker könnte das Telefon einer anderen Person sein. Eine
    // Navigation, die ihm stillschweigend folgt, ist schlimmer als eine, die
    // sagt „sag mir, welcher".
    it('rät bei mehreren nicht, sondern nennt die Auswahl im Protokoll', async () => {
      const warn = vi.fn();
      const { source, service } = makeSource(
        [
          trackerState({ entity_id: 'device_tracker.telefon' }),
          trackerState({ entity_id: 'device_tracker.ipad' }),
        ],
        { entityId: '', autoSelect: true, logger: { ...silentLogger, warn } },
      );
      await source.poll();
      expect(service.getLast()).toBeNull();
      expect(warn).toHaveBeenCalledTimes(1);
      expect(warn.mock.calls[0][1]).toEqual({
        verfuegbar: ['device_tracker.ipad', 'device_tracker.telefon'],
      });
    });

    it('schreibt das Protokoll nicht bei jedem Durchgang voll', async () => {
      const warn = vi.fn();
      const { source } = makeSource(
        [
          trackerState({ entity_id: 'device_tracker.telefon' }),
          trackerState({ entity_id: 'device_tracker.ipad' }),
        ],
        { entityId: '', autoSelect: true, logger: { ...silentLogger, warn } },
      );
      await source.poll();
      await source.poll();
      await source.poll();
      expect(warn).toHaveBeenCalledTimes(1);
    });

    // Ohne `autoSelect` bleibt es beim alten Verhalten: leer heißt aus.
    it('sucht ohne autoSelect nicht selbst', async () => {
      const { source, service } = makeSource([trackerState({ entity_id: 'device_tracker.telefon' })], {
        entityId: '',
      });
      expect(source.isConfigured()).toBe(false);
      await source.poll();
      expect(service.getLast()).toBeNull();
    });

    // Eine ausdrücklich eingetragene Entität schlägt die Automatik — sonst
    // wäre das Feld eine Anzeige statt einer Einstellung.
    it('bevorzugt die konfigurierte Entität, auch wenn autoSelect an ist', async () => {
      const { source, service } = makeSource(
        [
          trackerState({ entity_id: 'device_tracker.telefon', attributes: { latitude: 47.1, longitude: 9.5 } }),
          trackerState({ entity_id: 'device_tracker.ipad', attributes: { latitude: 48.2, longitude: 10.6 } }),
        ],
        { entityId: 'device_tracker.ipad', autoSelect: true },
      );
      await source.poll();
      expect(service.getLast()?.lat).toBe(48.2);
    });
  });

  it('fragt gar nicht erst ab, wenn keine HA-Verbindung konfiguriert ist', async () => {
    // Ein unkonfiguriertes Home Assistant darf nicht im Sekundentakt
    // angefragt werden -- und schon gar nicht die Navigation aufhalten.
    const fetchStates = vi.fn(async () => [trackerState()]);
    const service = new PositionService({ bus: new EventBus(), checkIntervalMs: 10_000 });
    const source = new HaTrackerSource({
      positionService: service,
      resolveConnection: () => null,
      entityId: 'device_tracker.mein_telefon',
      logger: silentLogger,
      fetchStates,
    });
    await source.poll();
    expect(fetchStates).not.toHaveBeenCalled();
  });

  it('verwirft einen unplausiblen Fix, statt ihn durchzureichen', async () => {
    // Zustaende aus einer fremden Anwendung sind ungeprueft -- genau wie ein
    // Fix aus dem Netz.
    const { source, service } = makeSource([
      trackerState({ attributes: { latitude: 47.1, longitude: 9.5, speed: 99999 } }),
    ]);
    await source.poll();
    expect(service.getLast()).toBeNull();
  });

  it('fängt einen Sprung ab (W-02), statt die Position springen zu lassen', async () => {
    // Ein Tracker, der nach einer Funkluecke 300 km weiter wieder auftaucht,
    // ist genau der Fall des PlausibilityGuard. Die Zeitstempel muessen dafuer
    // AUSEINANDERLIEGEN -- der Guard rechnet die Geschwindigkeit aus ihrer
    // Differenz. Genau deshalb ist `ts` der Zeitpunkt von Home Assistant und
    // nicht unser „jetzt": zwei erfundene „jetzt" liegen immer dicht
    // beieinander, und der Filter waere wirkungslos.
    const first = new Date();
    const second = new Date(first.getTime() + 2000);
    const states = [trackerState({ last_updated: first.toISOString() })];
    const { source, service } = makeSource(states);
    await source.poll();
    expect(service.getLast()?.lat).toBe(47.141);

    // 2 Sekunden spaeter ~380 km weiter -- das waere Mach 500.
    states[0] = trackerState({
      attributes: { latitude: 50.0, longitude: 8.0, gps_accuracy: 10 },
      last_updated: second.toISOString(),
    });
    await source.poll();
    expect(service.getLast()?.lat).toBe(47.141);
  });

  it('verwirft einen zu alten Zustand, statt ihn als aktuelle Position auszugeben', async () => {
    // Die gefaehrlichste Art von Falschaussage in einer Navigation: eine alte
    // Position, die aussieht wie eine Messung. Lieber gar keine -- dann
    // greift die GPS-Verlust-Behandlung (W-01), die es dafuer gibt.
    const alt = new Date(Date.now() - MAX_FIX_AGE_MS - 60_000).toISOString();
    const { source, service } = makeSource([trackerState({ last_updated: alt })]);
    await source.poll();
    expect(service.getLast()).toBeNull();
  });

  it('nimmt einen Zustand, der knapp innerhalb der Altersgrenze liegt', async () => {
    const frisch = new Date(Date.now() - (MAX_FIX_AGE_MS - 60_000)).toISOString();
    const { source, service } = makeSource([trackerState({ last_updated: frisch })]);
    await source.poll();
    expect(service.getLast()?.lat).toBe(47.141);
  });

  it('übernimmt den Zeitstempel von Home Assistant, nicht die eigene Uhr', () => {
    const gemeldet = '2026-09-03T08:00:00.000Z';
    const pos = toPosition(trackerState({ last_updated: gemeldet }));
    expect(pos?.ts).toBe(gemeldet);
  });

  it('stop() beendet den Abfragetakt', () => {
    const { source } = makeSource([trackerState()]);
    source.start();
    expect(() => source.stop()).not.toThrow();
    // Ein zweites stop() darf ebenfalls nicht stoeren.
    expect(() => source.stop()).not.toThrow();
  });
});
