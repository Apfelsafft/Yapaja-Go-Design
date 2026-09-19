/**
 * Der Auto-Zoom an der Kamera -- die Verdrahtung, nicht die Regel.
 *
 * ─── WARUM DAS EINE EIGENE DATEI IST ────────────────────────────────────────
 * `autoZoom.test.ts` prueft, WELCHE Stufe herauskommt. Das sagt nichts
 * darueber, ob sie jemals an der Karte ankommt. Genau dieser letzte Schritt
 * ist in diesem Projekt schon mehrfach das eigentliche Problem gewesen:
 * Ankunftszeit, Restzeit und Restdistanz wurden vom Core seit jeher
 * geliefert und berechnet -- und trotzdem sah sie niemand, weil sie nur in
 * einem Dashboard-Baustein standen. Eine Regel ohne Aufrufer ist keine
 * Funktion, sondern totes Gewicht.
 *
 * Geprueft wird deshalb `updateFollowMePosition` als Ganzes: was kommt bei
 * `mapController.setCamera` an?
 *
 * ─── DIE WICHTIGSTE ZUSICHERUNG STEHT UNTEN ─────────────────────────────────
 * „Der Mensch gewinnt immer": nach einem manuellen Schwenk pausiert Follow-Me
 * 10 Sekunden lang -- und dann darf auch der Auto-Zoom nicht eingreifen.
 * Sonst kaempft man beim Herauszoomen gegen die Automatik.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { NavState } from '@yapaia/shared';

const mockMap = {
  getZoom: vi.fn(() => 14),
  // Wie in `autoZoomStart.test.ts`: die Stufe wird seit 0.17.2 aus der
  // Bildhoehe und der Breite gerechnet, also muss die Nachbildung beides
  // kennen. 725 px ist ein Tablet quer (siehe `drivePadding.ts`).
  getContainer: vi.fn(() => ({ clientHeight: 725 })),
  getCenter: vi.fn(() => ({ lat: 49.5, lng: 8.4 })),
};

vi.mock('../state/mapStore', () => ({
  mapController: {
    getMap: vi.fn(() => mockMap),
    setCamera: vi.fn(),
    on: vi.fn(),
    off: vi.fn(),
  },
  useMapStore: vi.fn(),
}));

vi.mock('../position/positionStore', () => ({
  usePositionStore: {
    getState: vi.fn(() => ({ position: { lat: 48.1, lon: 2.3, heading: 45 } })),
  },
}));

import { mapController } from '../state/mapStore';
import {
  useFollowMeStore,
  updateFollowMePosition,
  recenterOnPosition,
  resetFollowCadence,
} from './followMe';
import { useNavStore } from '../drive/navStore';

const setCamera = mapController.setCamera as unknown as ReturnType<typeof vi.fn>;

function nav(overrides: Partial<NavState> = {}): NavState {
  return {
    status: 'navigating',
    route_id: 'r1',
    next_maneuver: null,
    distance_to_maneuver_m: null,
    distance_remaining_m: 12_345,
    duration_remaining_s: 1_800,
    eta: null,
    speed_kmh: 130,
    speed_limit_kmh: null,
    altitude_m: null,
    destination: null,
    ...overrides,
  };
}

/** Der Zoom, mit dem `setCamera` zuletzt aufgerufen wurde (`undefined` = keiner). */
function letzterZoom(): number | undefined {
  expect(setCamera).toHaveBeenCalledTimes(1);
  return setCamera.mock.calls[0][0].zoom;
}

beforeEach(() => {
  vi.clearAllMocks();
  mockMap.getZoom.mockReturnValue(14);
  useFollowMeStore.setState({ isFollowing: true, isPaused: false });
  useNavStore.setState({ navState: null });
});

describe('waehrend einer Fahrt', () => {
  it('kommt die Stufe wirklich an der Kamera an', () => {
    // ─── WARUM HIER 16,5 STEHT UND NICHT MEHR 17 ─────────────────────────
    // Bis 0.17.1 galt fuer alles unter 250 m die feste Stufe 17. Nachgerechnet
    // fuer diese Anzeige (725 px hoch, 49,5 Grad, Fahrzeug bei 75 % der Hoehe):
    //
    //   Stufe  | sichtbar voraus | Abbiegung bei 200 m liegt auf
    //   -------+-----------------+------------------------------
    //    17    |      211 m      |   95 %  -- kratzt am oberen Rand
    //    16,5  |      298 m      |   67 %  -- mit Strecke dahinter
    //
    // Genau das war die Meldung: „Man kann die nächste Abbiegung nicht gut
    // erkennen." Die Stufe GRIFF, sie stand nur so eng, dass der Abbiegepunkt
    // am Bildrand klebte und man nicht sah, was dahinter kommt.
    //
    // Die Zahl steht hier ausgeschrieben und nicht als Ausdruck aus dem
    // Pruefling: sonst bestaetigte dieser Test nur, dass die Formel mit sich
    // selbst uebereinstimmt.
    useNavStore.setState({ navState: nav({ distance_to_maneuver_m: 200 }) });

    updateFollowMePosition();

    expect(letzterZoom()).toBe(16.5);
  });

  it('bleibt die Kamera in Ruhe, wenn die Stufe schon stimmt', () => {
    // Ohne diese Zusicherung setzte jede Positionsmeldung den Zoom neu --
    // fuer den Menschen im Fahrzeug ein staendiges Zappeln der Karte.
    mockMap.getZoom.mockReturnValue(16.5);
    useNavStore.setState({ navState: nav({ distance_to_maneuver_m: 200 }) });

    updateFollowMePosition();

    expect(letzterZoom()).toBeUndefined();
  });

  it('wird ohne begruendbare Stufe nur zentriert', () => {
    useNavStore.setState({ navState: nav({ speed_kmh: null, distance_to_maneuver_m: null }) });

    updateFollowMePosition();

    expect(letzterZoom()).toBeUndefined();
    expect(setCamera.mock.calls[0][0].center).toEqual([2.3, 48.1]);
  });
});

describe('wann der Auto-Zoom sich heraushaelt', () => {
  it('ohne laufende Fahrt', () => {
    // Beim Planen schaut man sich die Strecke an. Ein Zoom, der einem dabei
    // die Uebersicht wegnimmt, ist eine Bewegung ohne Anlass.
    useNavStore.setState({ navState: nav({ status: 'idle', distance_to_maneuver_m: 200 }) });

    updateFollowMePosition();

    expect(letzterZoom()).toBeUndefined();
  });

  it('ganz ohne Navigationszustand', () => {
    updateFollowMePosition();

    expect(letzterZoom()).toBeUndefined();
  });

  it('nach einem manuellen Schwenk -- der Mensch gewinnt', () => {
    // Follow-Me pausiert nach einem Schwenk 10 Sekunden. In dieser Zeit darf
    // die Kamera GAR NICHT angefasst werden, auch nicht am Zoom.
    useNavStore.setState({ navState: nav({ distance_to_maneuver_m: 200 }) });
    useFollowMeStore.getState().pause();

    updateFollowMePosition();

    expect(setCamera).not.toHaveBeenCalled();
  });

  it('wenn Follow-Me ganz abgeschaltet ist', () => {
    useNavStore.setState({ navState: nav({ distance_to_maneuver_m: 200 }) });
    useFollowMeStore.setState({ isFollowing: false });

    updateFollowMePosition();

    expect(setCamera).not.toHaveBeenCalled();
  });
});

/**
 * Die Kamerafahrt beim Folgen läuft GLEICHFÖRMIG.
 *
 * ─── DIE MELDUNG ────────────────────────────────────────────────────────────
 * „Auch die Führung der Route ist noch irgendwie hakelig. Der blaue Punkt
 * folgt der blauen Linie aber es läuft nicht unbedingt smooth."
 *
 * ─── WARUM DAS EINE ZUSICHERUNG BRAUCHT ─────────────────────────────────────
 * Das ist der Rest, der nach dem Sprung-Fix übrig blieb — und er ist von
 * außen fast nicht zu benennen. `easeTo` ohne `easing` nimmt MapLibres
 * Vorgabe: langsam los, schnell in der Mitte, langsam ans Ziel. Beim Folgen
 * reiht sich eine solche Bewegung je Positionsmeldung an die nächste, jede
 * bremst am Ende auf null ab — die Karte pulsiert im Sekundentakt, obwohl
 * das Fahrzeug gleichmäßig fährt.
 *
 * Ein solcher Rückfall wäre für niemanden sichtbar, der den Code liest: es
 * fehlte schlicht ein Feld. Deshalb steht er hier.
 */
describe('die Kamerafahrt beim Folgen', () => {
  it('läuft gleichförmig, nicht an- und abschwellend', () => {
    useNavStore.setState({ navState: nav({ distance_to_maneuver_m: 200 }) });

    // Zweimal, mit einer Sekunde dazwischen: beim ERSTEN Mal ist der Takt
    // noch unbekannt, es wird gesprungen. Erst der zweite Aufruf animiert --
    // und die Dauer richtet sich nach dem Abstand, deshalb muss zwischen den
    // beiden wirklich Zeit vergehen.
    resetFollowCadence();
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date('2026-09-19T12:00:00Z'));
      updateFollowMePosition();
      vi.setSystemTime(new Date('2026-09-19T12:00:01Z'));
      updateFollowMePosition();
    } finally {
      vi.useRealTimers();
    }

    const letzte = setCamera.mock.calls[setCamera.mock.calls.length - 1];
    expect(letzte[1]?.animate, 'es wird überhaupt animiert').toBe(true);
    expect(letzte[1]?.stetig, 'und zwar gleichförmig').toBe(true);
  });

  it('ein einzelner Sprung zur Position bremst weiterhin ab', () => {
    // Die Gegenprobe. Gleichförmig ist NUR fürs Folgen richtig: der
    // Zurück-zur-Position-Knopf soll sichtbar ankommen, sonst sieht es aus,
    // als hätte jemand die Karte gerissen.
    recenterOnPosition();

    const letzte = setCamera.mock.calls[setCamera.mock.calls.length - 1];
    expect(letzte[1]?.stetig).toBeFalsy();
  });
});
