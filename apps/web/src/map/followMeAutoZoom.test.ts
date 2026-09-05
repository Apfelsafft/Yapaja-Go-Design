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
import type { NavState } from '@yapaja/shared';

const mockMap = { getZoom: vi.fn(() => 14) };

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
import { useFollowMeStore, updateFollowMePosition } from './followMe';
import { useNavStore } from '../drive/navStore';
import { MANEUVER_ZOOM } from './autoZoom';

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
    useNavStore.setState({ navState: nav({ distance_to_maneuver_m: 100 }) });

    updateFollowMePosition();

    expect(letzterZoom()).toBe(MANEUVER_ZOOM);
  });

  it('bleibt die Kamera in Ruhe, wenn die Stufe schon stimmt', () => {
    // Ohne diese Zusicherung setzte jede Positionsmeldung den Zoom neu --
    // fuer den Menschen im Fahrzeug ein staendiges Zappeln der Karte.
    mockMap.getZoom.mockReturnValue(MANEUVER_ZOOM);
    useNavStore.setState({ navState: nav({ distance_to_maneuver_m: 100 }) });

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
    useNavStore.setState({ navState: nav({ status: 'idle', distance_to_maneuver_m: 100 }) });

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
    useNavStore.setState({ navState: nav({ distance_to_maneuver_m: 100 }) });
    useFollowMeStore.getState().pause();

    updateFollowMePosition();

    expect(setCamera).not.toHaveBeenCalled();
  });

  it('wenn Follow-Me ganz abgeschaltet ist', () => {
    useNavStore.setState({ navState: nav({ distance_to_maneuver_m: 100 }) });
    useFollowMeStore.setState({ isFollowing: false });

    updateFollowMePosition();

    expect(setCamera).not.toHaveBeenCalled();
  });
});
