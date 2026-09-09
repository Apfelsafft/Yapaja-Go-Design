/**
 * Der Beobachter der Bedien-Helfer.
 *
 * Geprueft wird, was WIRKLICH ausgeloest wird -- nicht, ob eine Funktion
 * aufgerufen wurde. Der teuerste denkbare Fehler an dieser Stelle ist ein
 * Beendigungsbefehl, den niemand gegeben hat: er sieht aus wie ein Bedienen
 * und ist ein Neustart.
 */

import { describe, it, expect, vi } from 'vitest';
import { HELFER } from './commandHelpers.js';
import { HaCommandWatcher } from './commandWatcher.js';

const PAUSE = 'input_button.yapaia_pause';
const BEENDEN = 'input_button.yapaia_beenden';
const PROFIL = 'input_select.yapaia_profil';

function aufbauen(
  optionen: {
    zustaende?: Array<Map<string, string>>;
    mqttLiefert?: boolean;
    verbindung?: { apiBase: string; token: string } | null;
    profile?: Array<{ id: string; name: string }>;
  } = {},
) {
  const ausgefuehrt: string[] = [];
  const meldungen: string[] = [];
  const angelegt: string[][] = [];
  let runde = 0;
  const profile = optionen.profile ?? [
    { id: 'p1', name: 'Camper' },
    { id: 'p2', name: 'Alkoven 7.5t' },
  ];

  const watcher = new HaCommandWatcher({
    verbindung: () =>
      optionen.verbindung === undefined
        ? { apiBase: 'http://supervisor/core/api', token: 't' }
        : optionen.verbindung,
    mqttLiefert: () => optionen.mqttLiefert ?? false,
    leseZustaende: async () => {
      const wert = optionen.zustaende?.[runde] ?? new Map<string, string>();
      runde += 1;
      return wert;
    },
    navigation: {
      pause: () => ausgefuehrt.push('pause'),
      resume: () => ausgefuehrt.push('resume'),
      stop: () => ausgefuehrt.push('stop'),
    },
    profile: {
      getAll: () => profile,
      activate: (id: string) => ausgefuehrt.push(`profil:${id}`),
    },
    logger: { info: (m) => meldungen.push(m), warn: (m) => meldungen.push(m) },
    ws: {
      erzeugeSocket: () => {
        throw new Error('im Test nicht verwendet');
      },
      logger: { info: () => undefined, warn: () => undefined },
    },
    setIntervalImpl: () => 1,
    clearIntervalImpl: () => undefined,
  });

  return { watcher, ausgefuehrt, meldungen, angelegt };
}

describe('was der Beobachter ausloest', () => {
  it('loest beim ERSTEN Durchgang nichts aus', async () => {
    // Der Zustand eines input_button ist der Zeitpunkt des letzten Drucks --
    // auch wenn der von gestern ist. Ohne diese Regel beendete jeder
    // Neustart des Add-ons die laufende Fahrt.
    const a = aufbauen({
      zustaende: [
        new Map([
          [PAUSE, '2026-09-01T10:00:00Z'],
          [BEENDEN, '2026-09-01T10:00:00Z'],
        ]),
      ],
    });
    await a.watcher.takt();
    expect(a.ausgefuehrt).toEqual([]);
    a.watcher.dispose();
  });

  it('fuehrt beim zweiten Durchgang aus, was sich geaendert hat', async () => {
    const a = aufbauen({
      zustaende: [
        new Map([[PAUSE, 'alt']]),
        new Map([[PAUSE, 'neu']]),
      ],
    });
    await a.watcher.takt();
    await a.watcher.takt();
    expect(a.ausgefuehrt).toEqual(['pause']);
    a.watcher.dispose();
  });

  it('waehlt das Profil ueber den NAMEN und aktiviert dessen ID', async () => {
    const a = aufbauen({
      zustaende: [new Map([[PROFIL, 'Camper']]), new Map([[PROFIL, 'Alkoven 7.5t']])],
    });
    await a.watcher.takt();
    await a.watcher.takt();
    expect(a.ausgefuehrt).toEqual(['profil:p2']);
    a.watcher.dispose();
  });

  it('meldet ein unbekanntes Profil, statt still nichts zu tun', async () => {
    const a = aufbauen({
      zustaende: [new Map([[PROFIL, 'Camper']]), new Map([[PROFIL, 'Gibt Es Nicht']])],
    });
    await a.watcher.takt();
    await a.watcher.takt();
    expect(a.ausgefuehrt).toEqual([]);
    expect(a.meldungen.some((m) => m.includes('kein Profil'))).toBe(true);
    a.watcher.dispose();
  });

  it('haelt sich zurueck, solange MQTT die Bedienung liefert', async () => {
    // Zwei Saetze Knoepfe fuer dieselbe Sache waeren nur Verwirrung.
    const a = aufbauen({
      mqttLiefert: true,
      zustaende: [new Map([[PAUSE, 'alt']]), new Map([[PAUSE, 'neu']])],
    });
    await a.watcher.takt();
    await a.watcher.takt();
    expect(a.ausgefuehrt).toEqual([]);
    a.watcher.dispose();
  });

  it('tut nichts ohne Home-Assistant-Verbindung', async () => {
    const a = aufbauen({ verbindung: null, zustaende: [new Map([[PAUSE, 'x']])] });
    await a.watcher.takt();
    expect(a.ausgefuehrt).toEqual([]);
    a.watcher.dispose();
  });

  it('ueberlebt einen Fehlschlag beim Lesen', async () => {
    // Ein Aussetzer darf keinen Befehl ausloesen und keinen verschlucken.
    const ausgefuehrt: string[] = [];
    const watcher = new HaCommandWatcher({
      verbindung: () => ({ apiBase: 'x', token: 't' }),
      mqttLiefert: () => false,
      leseZustaende: async () => {
        throw new Error('Netz weg');
      },
      navigation: {
        pause: () => ausgefuehrt.push('pause'),
        resume: () => ausgefuehrt.push('resume'),
        stop: () => ausgefuehrt.push('stop'),
      },
      profile: { getAll: () => [], activate: () => undefined },
      logger: { info: () => undefined, warn: () => undefined },
      ws: { logger: { info: () => undefined, warn: () => undefined } },
      setIntervalImpl: () => 1,
      clearIntervalImpl: () => undefined,
    });
    await expect(watcher.takt()).resolves.toBeUndefined();
    expect(ausgefuehrt).toEqual([]);
    watcher.dispose();
  });

  it('laesst einen fehlschlagenden Befehl nicht den Beobachter mitreissen', async () => {
    // „Pause" ohne laufende Fahrt wirft -- das ist eine Meldung wert und kein
    // Grund, die Beobachtung einzustellen.
    const meldungen: string[] = [];
    const watcher = new HaCommandWatcher({
      verbindung: () => ({ apiBase: 'x', token: 't' }),
      mqttLiefert: () => false,
      leseZustaende: (() => {
        let n = 0;
        return async () => (n++ === 0 ? new Map([[PAUSE, 'a']]) : new Map([[PAUSE, 'b']]));
      })(),
      navigation: {
        pause: () => {
          throw new Error('keine Fahrt');
        },
        resume: () => undefined,
        stop: () => undefined,
      },
      profile: { getAll: () => [], activate: () => undefined },
      logger: { info: () => undefined, warn: (m) => meldungen.push(m) },
      ws: { logger: { info: () => undefined, warn: () => undefined } },
      setIntervalImpl: () => 1,
      clearIntervalImpl: () => undefined,
    });
    await watcher.takt();
    await expect(watcher.takt()).resolves.toBeUndefined();
    expect(meldungen.some((m) => m.includes('fehlgeschlagen'))).toBe(true);
    watcher.dispose();
  });

  it('schweigt nach dem Abhaengen', async () => {
    const a = aufbauen({ zustaende: [new Map([[PAUSE, 'a']]), new Map([[PAUSE, 'b']])] });
    await a.watcher.takt();
    a.watcher.dispose();
    await a.watcher.takt();
    expect(a.ausgefuehrt).toEqual([]);
  });
});

describe('das Anlegen der Helfer', () => {
  it('wird nur EINMAL versucht, auch wenn es scheitert', async () => {
    // Ein Versuch pro Sekunde waere eine Dauerlast ohne jede Aussicht auf ein
    // anderes Ergebnis (keine Rechte, WebSocket blockiert).
    const erzeuge = vi.fn(() => {
      throw new Error('kein WebSocket');
    });
    const watcher = new HaCommandWatcher({
      verbindung: () => ({ apiBase: 'http://supervisor/core/api', token: 't' }),
      mqttLiefert: () => false,
      leseZustaende: async () => new Map(), // nichts vorhanden -> alle fehlen
      navigation: { pause: () => undefined, resume: () => undefined, stop: () => undefined },
      profile: { getAll: () => [], activate: () => undefined },
      logger: { info: () => undefined, warn: () => undefined },
      ws: { erzeugeSocket: erzeuge, logger: { info: () => undefined, warn: () => undefined } },
      setIntervalImpl: () => 1,
      clearIntervalImpl: () => undefined,
    });
    await watcher.takt();
    await watcher.takt();
    await watcher.takt();
    expect(erzeuge).toHaveBeenCalledTimes(1);
    watcher.dispose();
  });

  it('wird gar nicht erst versucht, wenn alle Helfer da sind', async () => {
    const erzeuge = vi.fn();
    const watcher = new HaCommandWatcher({
      verbindung: () => ({ apiBase: 'x', token: 't' }),
      mqttLiefert: () => false,
      leseZustaende: async () => new Map(HELFER.map((h) => [h.entityId, 'a'] as const)),
      navigation: { pause: () => undefined, resume: () => undefined, stop: () => undefined },
      profile: { getAll: () => [], activate: () => undefined },
      logger: { info: () => undefined, warn: () => undefined },
      ws: { erzeugeSocket: erzeuge, logger: { info: () => undefined, warn: () => undefined } },
      setIntervalImpl: () => 1,
      clearIntervalImpl: () => undefined,
    });
    await watcher.takt();
    expect(erzeuge).not.toHaveBeenCalled();
    watcher.dispose();
  });
});
