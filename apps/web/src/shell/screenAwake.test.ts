/**
 * Der Bildschirm bleibt an -- und zwar auch da, wo es die Schnittstelle nicht
 * gibt.
 *
 * Der wichtigste Fall in dieser Datei ist der ZWEITE describe-Block: ohne
 * `navigator.wakeLock`. Genau so sieht es auf dem iPad des Betreibers aus,
 * weil Home Assistant dort ueber einfaches HTTP laeuft. Ein Test, der nur den
 * ersten Block prueft, wuerde eine Funktion abnehmen, die bei ihm nie laeuft.
 */

import { describe, it, expect, vi } from 'vitest';
import { ScreenAwake, type Umgebung, type WakeLockSentinelLike } from './screenAwake.js';

function sentinelBauen(): WakeLockSentinelLike & { freigaben: number; loesen(): void } {
  let melden: (() => void) | null = null;
  return {
    freigaben: 0,
    async release() {
      this.freigaben += 1;
    },
    addEventListener(_typ, listener) {
      melden = listener;
    },
    /** Der Browser gibt die Sperre von sich aus frei. */
    loesen() {
      melden?.();
    },
  };
}

interface Aufbau {
  umgebung: Umgebung;
  video: { play: ReturnType<typeof vi.fn>; pause: ReturnType<typeof vi.fn> };
  sentinel: ReturnType<typeof sentinelBauen>;
  setzeSichtbar(wert: boolean): void;
}

function aufbauen(optionen: { mitWakeLock?: boolean; videoSpielt?: boolean } = {}): Aufbau {
  const { mitWakeLock = true, videoSpielt = true } = optionen;
  let sichtbar = true;
  const sentinel = sentinelBauen();
  const video = {
    play: vi.fn(async () => {
      if (!videoSpielt) throw new Error('NotAllowedError');
    }),
    pause: vi.fn(),
  };
  return {
    sentinel,
    video,
    setzeSichtbar(wert) {
      sichtbar = wert;
    },
    umgebung: {
      wakeLock: mitWakeLock ? { request: vi.fn(async () => sentinel) } : null,
      video,
      sichtbar: () => sichtbar,
    },
  };
}

describe('mit der echten Schnittstelle (HTTPS)', () => {
  it('fordert die Sperre an und gibt sie wieder frei', async () => {
    const a = aufbauen();
    const wach = new ScreenAwake(a.umgebung);

    await wach.an();
    expect(wach.zustand().methode).toBe('wakelock');
    expect(a.video.play).not.toHaveBeenCalled();

    await wach.aus();
    expect(wach.zustand().methode).toBe('keine');
    expect(a.sentinel.freigaben).toBe(1);
  });

  it('fordert nach dem Wiedersichtbarwerden erneut an', async () => {
    // Der Browser gibt die Sperre beim Ausblenden VON SELBST frei. Ohne das
    // erneute Anfordern waere sie nach dem ersten App-Wechsel fuer immer weg.
    const a = aufbauen();
    const wach = new ScreenAwake(a.umgebung);
    await wach.an();

    a.setzeSichtbar(false);
    a.sentinel.loesen();
    await wach.sichtbarkeitGeaendert();
    expect(wach.zustand().methode).toBe('keine');

    a.setzeSichtbar(true);
    await wach.sichtbarkeitGeaendert();
    expect(wach.zustand().methode).toBe('wakelock');
  });

  it('bleibt still, wenn gar nicht wachgehalten werden soll', async () => {
    const a = aufbauen();
    const wach = new ScreenAwake(a.umgebung);
    a.setzeSichtbar(true);
    await wach.sichtbarkeitGeaendert();
    expect(a.umgebung.wakeLock!.request).not.toHaveBeenCalled();
  });
});

describe('ohne die Schnittstelle -- der Fall auf dem iPad ueber HTTP', () => {
  it('haelt den Bildschirm mit dem Video wach', async () => {
    const a = aufbauen({ mitWakeLock: false });
    const wach = new ScreenAwake(a.umgebung);

    await wach.an();
    expect(wach.zustand().methode).toBe('video');
    expect(a.video.play).toHaveBeenCalledTimes(1);

    await wach.aus();
    expect(a.video.pause).toHaveBeenCalledTimes(1);
    expect(wach.zustand().methode).toBe('keine');
  });

  it('nimmt das Video auch, wenn die Sperre abgelehnt wird', async () => {
    // Stromsparmodus: die Schnittstelle ist da, sagt aber nein.
    const a = aufbauen();
    a.umgebung.wakeLock = {
      request: vi.fn(async () => {
        throw new Error('NotAllowedError');
      }),
    };
    const wach = new ScreenAwake(a.umgebung);

    await wach.an();
    expect(wach.zustand().methode).toBe('video');
  });

  it('wartet auf die erste Bedienung, wenn das Video abgelehnt wird', async () => {
    const a = aufbauen({ mitWakeLock: false, videoSpielt: false });
    const wach = new ScreenAwake(a.umgebung);

    await wach.an();
    expect(wach.zustand()).toMatchObject({ methode: 'keine', wartetAufGeste: true });

    // Eine Geste, ohne dass sich am Video etwas geaendert hat: es bleibt beim
    // Warten -- aber ein zweiter Versuch hat stattgefunden.
    await wach.geste();
    expect(a.video.play).toHaveBeenCalledTimes(2);
  });

  it('und spielt es, sobald die Bedienung es erlaubt', async () => {
    const a = aufbauen({ mitWakeLock: false, videoSpielt: false });
    const wach = new ScreenAwake(a.umgebung);
    await wach.an();

    a.video.play.mockImplementation(async () => undefined);
    await wach.geste();
    expect(wach.zustand().methode).toBe('video');
  });

  it('ignoriert Gesten, solange nichts gewuenscht ist', async () => {
    const a = aufbauen({ mitWakeLock: false, videoSpielt: false });
    const wach = new ScreenAwake(a.umgebung);
    await wach.geste();
    expect(a.video.play).not.toHaveBeenCalled();
  });
});

describe('was nicht passieren darf', () => {
  it('haelt keine Sperre, die niemand mehr freigibt', async () => {
    // `aus()` faellt zwischen das Anfordern und dessen Antwort. Ohne die
    // Nachpruefung bliebe der Bildschirm fuer immer an -- unsichtbar, weil
    // der Zustand „keine" meldet.
    const a = aufbauen();
    let aufloesen: ((s: WakeLockSentinelLike) => void) | null = null;
    a.umgebung.wakeLock = {
      request: vi.fn(
        () =>
          new Promise<WakeLockSentinelLike>((res) => {
            aufloesen = res;
          }),
      ),
    };
    const wach = new ScreenAwake(a.umgebung);

    const laeuft = wach.an();
    await wach.aus();
    aufloesen!(a.sentinel);
    await laeuft;

    expect(wach.zustand().methode).toBe('keine');
    expect(a.sentinel.freigaben).toBe(1);
  });

  it('fordert nichts an, solange die Seite unsichtbar ist', async () => {
    const a = aufbauen();
    a.setzeSichtbar(false);
    const wach = new ScreenAwake(a.umgebung);
    await wach.an();
    expect(a.umgebung.wakeLock!.request).not.toHaveBeenCalled();
    expect(a.video.play).not.toHaveBeenCalled();
    expect(wach.zustand().gewuenscht).toBe(true);
  });

  it('fordert nicht doppelt an', async () => {
    const a = aufbauen();
    const wach = new ScreenAwake(a.umgebung);
    await wach.an();
    await wach.an();
    expect(a.umgebung.wakeLock!.request).toHaveBeenCalledTimes(1);
  });

  it('kommt ohne jede Moeglichkeit klar', async () => {
    // Kein wakeLock, kein Video: die Anwendung darf davon nichts merken.
    const wach = new ScreenAwake({ wakeLock: null, video: null, sichtbar: () => true });
    await wach.an();
    expect(wach.zustand()).toMatchObject({ gewuenscht: true, methode: 'keine' });
    await wach.aus();
  });
});
