/**
 * Der Auto-Zoom beim Losfahren.
 *
 * ─── DIE MELDUNG ────────────────────────────────────────────────────────────
 * „Der Zoom wirkt noch nicht ausgereift. Insbesondere bei Start ist noch recht
 * weit rausgezoomt. Da waere es besser wenn man die naechsten Strassen
 * deutlicher sieht."
 *
 * ─── DIE URSACHE WAR DER ZEITPUNKT ──────────────────────────────────────────
 * Bei Stillstand waere die Stufe bereits die dichteste gewesen -- der
 * Auto-Zoom hing aber ausschliesslich an einer NEUEN Positionsmeldung. Beim
 * Losfahren blieb also die Uebersicht stehen, in der die Route geplant wurde.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { NavState } from '@yapaja/shared';

const mockMap = { getZoom: vi.fn(() => 11) };

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
    getState: vi.fn(() => ({ position: mockPosition })),
  },
}));

let mockPosition: { lat: number; lon: number; heading: number } | null = null;

import { mapController } from '../state/mapStore';
import {
  MAX_ANIMATE_MS,
  applyAutoZoomNow,
  followAnimationMs,
  resetFollowCadence,
  useFollowMeStore,
} from './followMe';
import { useNavStore } from '../drive/navStore';
import { MANEUVER_ZOOM } from './autoZoom';

const setCamera = mapController.setCamera as unknown as ReturnType<typeof vi.fn>;

function nav(overrides: Partial<NavState> = {}): NavState {
  return {
    status: 'navigating',
    route_id: 'r1',
    next_maneuver: null,
    distance_to_maneuver_m: null,
    distance_remaining_m: 5_000,
    duration_remaining_s: 600,
    eta: null,
    // Beim Losfahren steht das Fahrzeug noch.
    speed_kmh: 0,
    speed_limit_kmh: null,
    altitude_m: null,
    destination: null,
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockMap.getZoom.mockReturnValue(11); // Uebersicht, wie nach dem Planen
  mockPosition = { lat: 48.1, lon: 2.3, heading: 45 };
  useFollowMeStore.setState({ isFollowing: true, isPaused: false });
  useNavStore.setState({ navState: null });
});

describe('beim Beginn einer Fahrt', () => {
  it('wird sofort herangeholt, ohne auf eine neue Position zu warten', () => {
    useNavStore.setState({ navState: nav() });

    applyAutoZoomNow();

    expect(setCamera).toHaveBeenCalledTimes(1);
    const arg = setCamera.mock.calls[0][0];
    expect(arg.zoom, 'im Stand gilt die dichteste Stufe').toBe(MANEUVER_ZOOM);
    expect(arg.center).toEqual([2.3, 48.1]);
  });

  it('und zwar naeher als die Planungsuebersicht', () => {
    // Der eigentliche Punkt der Meldung: 11 ist die Uebersicht, in der die
    // Route geplant wurde. Dort blieb die Karte bisher stehen.
    useNavStore.setState({ navState: nav() });
    applyAutoZoomNow();
    expect(setCamera.mock.calls[0][0].zoom).toBeGreaterThan(11);
  });
});

describe('wann nichts passiert', () => {
  it('ohne laufende Fahrt', () => {
    useNavStore.setState({ navState: nav({ status: 'idle' }) });
    applyAutoZoomNow();
    expect(setCamera).not.toHaveBeenCalled();
  });

  it('nach einem manuellen Schwenk -- der Mensch gewinnt weiterhin', () => {
    useNavStore.setState({ navState: nav() });
    useFollowMeStore.getState().pause();
    applyAutoZoomNow();
    expect(setCamera).not.toHaveBeenCalled();
  });

  it('wenn Follow-Me ganz abgeschaltet ist', () => {
    useNavStore.setState({ navState: nav() });
    useFollowMeStore.setState({ isFollowing: false });
    applyAutoZoomNow();
    expect(setCamera).not.toHaveBeenCalled();
  });

  it('ohne bekannte Position', () => {
    useNavStore.setState({ navState: nav() });
    mockPosition = null;
    applyAutoZoomNow();
    expect(setCamera).not.toHaveBeenCalled();
  });

  it('wenn die Karte schon richtig steht', () => {
    // Sonst waere jeder Fahrtbeginn eine Kamerabewegung, auch wenn sich
    // nichts aendert.
    mockMap.getZoom.mockReturnValue(MANEUVER_ZOOM);
    useNavStore.setState({ navState: nav() });
    applyAutoZoomNow();
    expect(setCamera).not.toHaveBeenCalled();
  });
});

describe('fluessig statt sprunghaft', () => {
  it('die erste Meldung springt -- es gibt noch keinen Takt', () => {
    resetFollowCadence();
    expect(followAnimationMs(null)).toBeNull();
  });

  it('danach dauert die Bewegung ungefaehr den Abstand der Meldungen', () => {
    // Im Sekundentakt: die Kamera braucht eine Sekunde und kommt an, wenn
    // die naechste Position eintrifft.
    expect(followAnimationMs(1000)).toBe(1000);
    expect(followAnimationMs(500)).toBe(500);
  });

  it('bei sehr kurzen Abstaenden wird gesprungen', () => {
    // Zeitraffer 32x: alle ~31 ms eine Meldung. Eine Animation darueber
    // kostet mehr, als sie glaettet.
    expect(followAnimationMs(31)).toBeNull();
    expect(followAnimationMs(0)).toBeNull();
  });

  it('und bei sehr langen gedeckelt', () => {
    // Nach einer Pause (GPS weg, App im Hintergrund) soll die Karte nicht
    // minutenlang kriechen.
    expect(followAnimationMs(60_000)).toBe(MAX_ANIMATE_MS);
  });

  it('ein unbrauchbarer Wert springt, statt zu raten', () => {
    expect(followAnimationMs(Number.NaN)).toBeNull();
  });
});
