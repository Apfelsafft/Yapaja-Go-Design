/**
 * Die Messung des langen Drucks.
 *
 * ─── WARUM DAS OHNE BROWSER PRUEFBAR SEIN MUSS ──────────────────────────────
 * Weil in dieser Geste jeder Fehler ein LEISER ist. Feuert sie zu leicht,
 * setzt ein Wischer wieder ein Ziel — der gemeldete Fehler waere zurueck,
 * nur seltener und damit schwerer zu glauben. Feuert sie gar nicht, gibt es
 * ueberhaupt keinen Weg mehr, aus der Karte ein Ziel zu setzen.
 *
 * Ein Browsertest deckt einen Weg ab, den echten. Hier lassen sich die
 * Raender durchgehen, die im Browser kaum zu treffen sind: der zweite
 * Finger, die rechte Maustaste, das Abmelden mitten im Lauf.
 *
 * Die Karte ist dafuer auf das reduziert, was `langerDruck.ts` benutzt —
 * `on`/`off`. Ein echtes MapLibre waere hier nur ein langsamerer Weg zur
 * selben Auskunft.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { Map as MapLibreMap } from 'maplibre-gl';
import { langerDruckUeberwachen, DRUCKDAUER_MS, WACKEL_PX } from './langerDruck.js';

/** Eine Karte, die sich nur merkt, wer auf was hoert. */
function karteBauen(): {
  map: MapLibreMap;
  feuern: (typ: string, e: unknown) => void;
  hoerer: number;
} {
  const hoerer = new Map<string, Set<(e: unknown) => void>>();
  const map = {
    on(typ: string, fn: (e: unknown) => void) {
      if (!hoerer.has(typ)) hoerer.set(typ, new Set());
      hoerer.get(typ)!.add(fn);
    },
    off(typ: string, fn: (e: unknown) => void) {
      hoerer.get(typ)?.delete(fn);
    },
  };
  return {
    map: map as unknown as MapLibreMap,
    feuern: (typ, e) => {
      for (const fn of [...(hoerer.get(typ) ?? [])]) fn(e);
    },
    get hoerer() {
      let n = 0;
      for (const s of hoerer.values()) n += s.size;
      return n;
    },
  } as never;
}

function ereignis(x: number, y: number, button = 0): unknown {
  return { point: { x, y }, lngLat: { lat: 48.5, lng: 9.0 }, originalEvent: { button } };
}

describe('langerDruckUeberwachen', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('meldet einen Druck, der lang genug ruhig bleibt', () => {
    const { map, feuern } = karteBauen();
    const gedrueckt = vi.fn();
    langerDruckUeberwachen(map, gedrueckt);

    feuern('mousedown', ereignis(100, 100));
    vi.advanceTimersByTime(DRUCKDAUER_MS);

    expect(gedrueckt).toHaveBeenCalledTimes(1);
    expect(gedrueckt.mock.calls[0][0]).toEqual({
      lngLat: { lat: 48.5, lng: 9.0 },
      point: { x: 100, y: 100 },
    });
  });

  it('meldet NICHT, solange die Zeit nicht um ist', () => {
    // Die Haelfte der Zeit ist ein Tipper, kein Druck. Ohne diese
    // Gegenprobe waere die Dauer auf 0 zu setzen, ohne dass es auffaellt.
    const { map, feuern } = karteBauen();
    const gedrueckt = vi.fn();
    langerDruckUeberwachen(map, gedrueckt);

    feuern('mousedown', ereignis(100, 100));
    vi.advanceTimersByTime(DRUCKDAUER_MS - 1);

    expect(gedrueckt).not.toHaveBeenCalled();
  });

  it('bricht ab, wenn der Finger vorher loslaesst', () => {
    const { map, feuern } = karteBauen();
    const gedrueckt = vi.fn();
    langerDruckUeberwachen(map, gedrueckt);

    feuern('touchstart', ereignis(100, 100));
    vi.advanceTimersByTime(DRUCKDAUER_MS - 50);
    feuern('touchend', ereignis(100, 100));
    vi.advanceTimersByTime(1000);

    expect(gedrueckt).not.toHaveBeenCalled();
  });

  it('bricht ab, wenn der Finger zu weit wandert', () => {
    const { map, feuern } = karteBauen();
    const gedrueckt = vi.fn();
    langerDruckUeberwachen(map, gedrueckt);

    feuern('touchstart', ereignis(100, 100));
    feuern('touchmove', ereignis(100 + WACKEL_PX + 1, 100));
    vi.advanceTimersByTime(DRUCKDAUER_MS);

    expect(gedrueckt).not.toHaveBeenCalled();
  });

  it('haelt ein Zittern innerhalb der Schwelle aus', () => {
    // ─── WARUM DIE SCHWELLE NICHT NULL IST ──────────────────────────────
    // Eine Hand im fahrenden Fahrzeug haelt nichts auf den Punkt still. Mit
    // einer Schwelle von 0 waere der lange Druck genau dort unbrauchbar, wo
    // dieses Geraet steht.
    const { map, feuern } = karteBauen();
    const gedrueckt = vi.fn();
    langerDruckUeberwachen(map, gedrueckt);

    feuern('touchstart', ereignis(100, 100));
    feuern('touchmove', ereignis(100 + WACKEL_PX - 1, 100));
    vi.advanceTimersByTime(DRUCKDAUER_MS);

    expect(gedrueckt).toHaveBeenCalledTimes(1);
    // Gemeldet wird der ANFANG, nicht die verwackelte Endstelle: gemeint war
    // die Stelle, auf die der Finger gesetzt wurde.
    expect(gedrueckt.mock.calls[0][0].point).toEqual({ x: 100, y: 100 });
  });

  it('bricht ab, sobald MapLibre die Beruehrung als Schwenk annimmt', () => {
    // `movestart` deckt Ziehen, Zoomen, Drehen und Kippen in einem ab --
    // solange es vom Bedienenden kommt. Das erkennt man an `originalEvent`.
    const { map, feuern } = karteBauen();
    const gedrueckt = vi.fn();
    langerDruckUeberwachen(map, gedrueckt);

    feuern('mousedown', ereignis(100, 100));
    feuern('movestart', { originalEvent: { type: 'mousemove' } });
    vi.advanceTimersByTime(DRUCKDAUER_MS);

    expect(gedrueckt).not.toHaveBeenCalled();
  });

  it('ueberlebt eine Kamerafahrt, die das Programm selbst ausloest', () => {
    // ─── DER FEHLER, DEN DIESER TEST FESTHAELT ──────────────────────────
    // Zuerst brach JEDES `movestart` den Druck ab. `movestart` meldet aber
    // auch, was das Programm selbst tut: das Einpassen auf eine Route, den
    // Re-Center-Knopf, eine Animation nach dem Laden -- und vor allem
    // Follow-Me, das die Karte im Fahrbetrieb dauernd nachzieht.
    //
    // Der lange Druck war damit ausgerechnet dann nicht durchzubringen,
    // wenn sich auf der Karte gerade etwas tut. Das ist der Normalfall.
    //
    // Programmatische Bewegungen tragen KEIN `originalEvent` -- genau daran
    // sind sie zu erkennen.
    const { map, feuern } = karteBauen();
    const gedrueckt = vi.fn();
    langerDruckUeberwachen(map, gedrueckt);

    feuern('mousedown', ereignis(100, 100));
    feuern('movestart', {});           // z. B. `map.easeTo(...)`
    feuern('movestart', { originalEvent: undefined });
    vi.advanceTimersByTime(DRUCKDAUER_MS);

    expect(gedrueckt).toHaveBeenCalledTimes(1);
  });

  it('zaehlt die rechte Maustaste nicht mit', () => {
    // Die ist der Rechtsklick, und den behandelt `contextmenu`. Beides zu
    // zaehlen ergaebe zwei Ziele aus einer Handlung.
    const { map, feuern } = karteBauen();
    const gedrueckt = vi.fn();
    langerDruckUeberwachen(map, gedrueckt);

    feuern('mousedown', ereignis(100, 100, 2));
    vi.advanceTimersByTime(DRUCKDAUER_MS);

    expect(gedrueckt).not.toHaveBeenCalled();
  });

  it('zaehlt zwei Finger nicht mit', () => {
    // Zwei Finger sind eine Zoom- oder Drehgeste. Sie als Druck zu lesen
    // setzte beim Heranzoomen ein Ziel.
    const { map, feuern } = karteBauen();
    const gedrueckt = vi.fn();
    langerDruckUeberwachen(map, gedrueckt);

    feuern('touchstart', {
      point: { x: 100, y: 100 },
      lngLat: { lat: 48.5, lng: 9.0 },
      points: [
        { x: 100, y: 100 },
        { x: 140, y: 140 },
      ],
    });
    vi.advanceTimersByTime(DRUCKDAUER_MS);

    expect(gedrueckt).not.toHaveBeenCalled();
  });

  it('meldet nach dem Abmelden nichts mehr', () => {
    // ─── DER FALL, DER SONST EIN ABSTURZ WAERE ──────────────────────────
    // Wird die Komponente abgebaut, waehrend der Finger noch liegt, zeigte
    // ein stehengebliebener Zeitgeber auf eine Karte, die es nicht mehr
    // gibt.
    const { map, feuern } = karteBauen();
    const gedrueckt = vi.fn();
    const abmelden = langerDruckUeberwachen(map, gedrueckt);

    feuern('mousedown', ereignis(100, 100));
    abmelden();
    vi.advanceTimersByTime(DRUCKDAUER_MS * 2);

    expect(gedrueckt).not.toHaveBeenCalled();
  });

  it('meldet jeden Hoerer wieder ab', () => {
    const gebaut = karteBauen();
    const abmelden = langerDruckUeberwachen(gebaut.map, vi.fn());
    expect(gebaut.hoerer).toBeGreaterThan(0);
    abmelden();
    expect(gebaut.hoerer).toBe(0);
  });

  it('ein zweiter Druck nach einem ersten wird auch gemeldet', () => {
    // Ein einmal ausgeloester Zeitgeber darf den naechsten nicht blockieren.
    const { map, feuern } = karteBauen();
    const gedrueckt = vi.fn();
    langerDruckUeberwachen(map, gedrueckt);

    feuern('mousedown', ereignis(100, 100));
    vi.advanceTimersByTime(DRUCKDAUER_MS);
    feuern('mouseup', ereignis(100, 100));

    feuern('mousedown', ereignis(200, 200));
    vi.advanceTimersByTime(DRUCKDAUER_MS);

    expect(gedrueckt).toHaveBeenCalledTimes(2);
    expect(gedrueckt.mock.calls[1][0].point).toEqual({ x: 200, y: 200 });
  });
});
