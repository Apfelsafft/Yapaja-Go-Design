/**
 * Bedienen ohne MQTT -- die Helfer und ihre Erkennung.
 *
 * ─── DER TEURE FEHLER, DEN ES HIER ZU VERHINDERN GILT ───────────────────────
 * Der Zustand eines `input_button` ist der ZEITPUNKT des letzten Drucks --
 * auch wenn der von gestern ist. Wer den ersten gelesenen Wert als Druck
 * wertet, beendet bei jedem Neustart des Add-ons die laufende Fahrt, bevor
 * jemand etwas angefasst hat. Genau das prueft der erste Fall unten.
 */

import { describe, it, expect, vi } from 'vitest';
import {
  HELFER,
  erkenneBefehle,
  fehlendeHelfer,
  legeHelferAn,
  wsUrlFor,
  type WebSocketAehnlich,
} from './commandHelpers.js';

const IDS = HELFER.map((h) => h.entityId);

describe('welche Helfer es gibt', () => {
  it('drei Schaltflaechen und eine Auswahl, alle mit eigener Entity-ID', () => {
    expect(HELFER).toHaveLength(4);
    expect(new Set(IDS).size).toBe(4);
    expect(IDS.filter((id) => id.startsWith('input_button.'))).toHaveLength(3);
    expect(IDS.filter((id) => id.startsWith('input_select.'))).toHaveLength(1);
  });

  it('kollidiert nicht mit den MQTT-Entitaeten', () => {
    // `button.yapaja_stop` (MQTT) und `input_button.yapaia_beenden` (Helfer)
    // sind verschiedene Bereiche -- sonst schriebe man sich gegenseitig zu.
    for (const id of IDS) {
      expect(id.startsWith('input_')).toBe(true);
    }
  });

  it('meldet genau die fehlenden', () => {
    expect(fehlendeHelfer(new Set(IDS))).toEqual([]);
    expect(fehlendeHelfer(new Set()).map((h) => h.entityId)).toEqual(IDS);
    expect(fehlendeHelfer(new Set([IDS[0]])).map((h) => h.entityId)).toEqual(IDS.slice(1));
  });
});

describe('die WebSocket-Adresse', () => {
  it('fuer den Supervisor-Umweg des Add-ons', () => {
    expect(wsUrlFor('http://supervisor/core/api')).toBe('ws://supervisor/core/websocket');
  });

  it('fuer eine direkt eingetragene Instanz', () => {
    // Wer nur den Add-on-Fall behandelt, baut eine Funktion, die in der
    // anderen Haelfte der Installationen still nichts tut.
    expect(wsUrlFor('http://ha.lan:8123/api')).toBe('ws://ha.lan:8123/api/websocket');
    expect(wsUrlFor('https://ha.example/api')).toBe('wss://ha.example/api/websocket');
  });
});

describe('was als Befehl zaehlt', () => {
  const pause = 'input_button.yapaia_pause';
  const profil = 'input_select.yapaia_profil';

  it('der ERSTE gelesene Wert ist nur die Grundlinie', () => {
    // Sonst beendete jeder Neustart des Add-ons die laufende Fahrt.
    const befehle = erkenneBefehle(new Map(), new Map([[pause, '2026-09-01T10:00:00Z']]));
    expect(befehle).toEqual([]);
  });

  it('ein geaenderter Zeitpunkt ist ein Druck', () => {
    const befehle = erkenneBefehle(
      new Map([[pause, '2026-09-01T10:00:00Z']]),
      new Map([[pause, '2026-09-09T18:00:00Z']]),
    );
    expect(befehle).toEqual([{ befehl: 'pause' }]);
  });

  it('ein unveraenderter Zeitpunkt ist keiner', () => {
    const gleich = new Map([[pause, '2026-09-01T10:00:00Z']]);
    expect(erkenneBefehle(gleich, new Map(gleich))).toEqual([]);
  });

  it('bei der Auswahl zaehlt der gewaehlte Wert', () => {
    expect(
      erkenneBefehle(new Map([[profil, 'Camper']]), new Map([[profil, 'Alkoven 7.5t']])),
    ).toEqual([{ befehl: 'profile', wert: 'Alkoven 7.5t' }]);
  });

  it('„unknown" ist keine Wahl', () => {
    // Eine frisch angelegte Auswahl steht auf „unknown" -- das darf kein
    // Profilwechsel auf ein Profil dieses Namens ausloesen.
    for (const wert of ['unknown', 'unavailable', '']) {
      expect(erkenneBefehle(new Map([[profil, 'Camper']]), new Map([[profil, wert]]))).toEqual([]);
    }
  });

  it('mehrere Aenderungen ergeben mehrere Befehle', () => {
    const vorher = new Map([
      [pause, 'a'],
      [profil, 'Camper'],
    ]);
    const jetzt = new Map([
      [pause, 'b'],
      [profil, 'Kastenwagen'],
    ]);
    expect(erkenneBefehle(vorher, jetzt)).toHaveLength(2);
  });

  it('eine verschwundene Entitaet loest nichts aus', () => {
    expect(erkenneBefehle(new Map([[pause, 'a']]), new Map())).toEqual([]);
  });
});

/** Ein WebSocket, der sich von Hand steuern laesst. */
function socketAttrappe() {
  const gesendet: string[] = [];
  const hoerer = new Map<string, Array<(e?: unknown) => void>>();
  const socket: WebSocketAehnlich = {
    send: (data: string) => gesendet.push(data),
    close: () => undefined,
    addEventListener: (typ: string, hoerender: (e?: unknown) => void) => {
      const liste = hoerer.get(typ) ?? [];
      liste.push(hoerender);
      hoerer.set(typ, liste);
    },
  } as WebSocketAehnlich;
  return {
    socket,
    gesendet,
    empfange: (nachricht: unknown) => {
      for (const h of hoerer.get('message') ?? []) h({ data: JSON.stringify(nachricht) });
    },
    ausloesen: (typ: 'error' | 'close') => {
      for (const h of hoerer.get(typ) ?? []) h();
    },
  };
}

const stillerLogger = { info: () => undefined, warn: () => undefined };

describe('die Helfer anlegen', () => {
  it('meldet sich an und legt jeden fehlenden an', async () => {
    const a = socketAttrappe();
    const laeuft = legeHelferAn(
      { apiBase: 'http://supervisor/core/api', token: 'geheim' },
      HELFER,
      { profile: ['Camper'] },
      { erzeugeSocket: () => a.socket, logger: stillerLogger },
    );

    a.empfange({ type: 'auth_required' });
    expect(JSON.parse(a.gesendet[0])).toEqual({ type: 'auth', access_token: 'geheim' });

    a.empfange({ type: 'auth_ok' });
    const befehle = a.gesendet.slice(1).map((n) => JSON.parse(n));
    expect(befehle.map((b) => b.type)).toEqual([
      'input_button/create',
      'input_button/create',
      'input_button/create',
      'input_select/create',
    ]);
    // Die Auswahl braucht Optionen -- sonst legt Home Assistant sie nicht an.
    expect(befehle[3].options).toEqual(['Camper']);

    for (const b of befehle) a.empfange({ id: b.id, type: 'result', success: true });
    await expect(laeuft).resolves.toEqual(HELFER.map((h) => h.entityId));
  });

  it('gibt der Auswahl auch ohne Profile eine Option', async () => {
    // Ohne mindestens eine Option lehnt Home Assistant das Anlegen ab -- und
    // die Auswahl fehlte still.
    const a = socketAttrappe();
    void legeHelferAn(
      { apiBase: 'http://supervisor/core/api', token: 't' },
      HELFER.filter((h) => h.typ === 'input_select'),
      {},
      { erzeugeSocket: () => a.socket, logger: stillerLogger },
    );
    a.empfange({ type: 'auth_ok' });
    expect(JSON.parse(a.gesendet[0]).options).toHaveLength(1);
  });

  it('gibt bei abgelehnter Anmeldung auf, statt zu haengen', async () => {
    const a = socketAttrappe();
    const warnungen: string[] = [];
    const laeuft = legeHelferAn(
      { apiBase: 'http://supervisor/core/api', token: 'falsch' },
      HELFER,
      {},
      { erzeugeSocket: () => a.socket, logger: { info: () => undefined, warn: (m) => warnungen.push(m) } },
    );
    a.empfange({ type: 'auth_invalid' });
    await expect(laeuft).resolves.toEqual([]);
    expect(warnungen.some((w) => w.includes('Anmeldung'))).toBe(true);
  });

  it('meldet einen abgelehnten Helfer und laeuft weiter', async () => {
    const a = socketAttrappe();
    const warnungen: string[] = [];
    const laeuft = legeHelferAn(
      { apiBase: 'http://supervisor/core/api', token: 't' },
      HELFER.slice(0, 2),
      {},
      { erzeugeSocket: () => a.socket, logger: { info: () => undefined, warn: (m) => warnungen.push(m) } },
    );
    a.empfange({ type: 'auth_ok' });
    const ids = a.gesendet.map((n) => JSON.parse(n).id);
    a.empfange({ id: ids[0], type: 'result', success: false, error: { message: 'nope' } });
    a.empfange({ id: ids[1], type: 'result', success: true });
    await expect(laeuft).resolves.toEqual([HELFER[1].entityId]);
    expect(warnungen).toHaveLength(1);
  });

  it('wirft nicht, wenn gar keine Verbindung zustande kommt', async () => {
    // Fehlende Bedienknoepfe sind aergerlich; ein Add-on, das deshalb nicht
    // startet, waere schlimmer.
    await expect(
      legeHelferAn(
        { apiBase: 'http://supervisor/core/api', token: 't' },
        HELFER,
        {},
        {
          erzeugeSocket: () => {
            throw new Error('kein Netz');
          },
          logger: stillerLogger,
        },
      ),
    ).resolves.toEqual([]);
  });

  it('gibt bei einer abbrechenden Leitung auf', async () => {
    const a = socketAttrappe();
    const laeuft = legeHelferAn(
      { apiBase: 'http://supervisor/core/api', token: 't' },
      HELFER,
      {},
      { erzeugeSocket: () => a.socket, logger: stillerLogger },
    );
    a.ausloesen('close');
    await expect(laeuft).resolves.toEqual([]);
  });

  it('tut nichts, wenn nichts fehlt', async () => {
    const erzeuge = vi.fn();
    await expect(
      legeHelferAn({ apiBase: 'x', token: 't' }, [], {}, { erzeugeSocket: erzeuge, logger: stillerLogger }),
    ).resolves.toEqual([]);
    expect(erzeuge).not.toHaveBeenCalled();
  });
});
