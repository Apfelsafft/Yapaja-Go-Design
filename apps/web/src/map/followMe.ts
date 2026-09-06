/**
 * Follow-Me Logic (E01-T3)
 *
 * Keeps the map camera centered on the current position when active.
 * Manual pan/drag by the user (detected via maplibregl dragstart/movestart events
 * with originalEvent set) pauses Follow for 10 seconds.
 *
 * Programmatic camera movements (from viewMode transitions, compass clicks, etc.)
 * do NOT count as manual pan and do not trigger pause.
 */

import { create } from 'zustand';
import { mapController } from '../state/mapStore';
import { usePositionStore } from '../position/positionStore';

import { autoZoomFor, shouldApplyZoom } from './autoZoom.js';
import { useNavStore } from '../drive/navStore.js';
import { isDriveActive } from '../drive/driveActive.js';
const PAUSE_DURATION = 10_000; // 10 seconds

/**
 * Mindest-Zoomstufe, auf die der Zurück-zur-Position-Knopf heranholt.
 *
 * 15 ist eine Stufe näher als die Zielsuche (`SEARCH_FLY_TO_ZOOM = 14`, dort
 * geht es um „wo liegt der Ort"), denn hier geht es um „wo stehe ich" — auf
 * 15 sind einzelne Straßen und ihre Namen zu erkennen. Weiter heran wäre für
 * eine Übersicht der nächsten Abzweigung schon zu eng.
 */
export const RECENTER_MIN_ZOOM = 15;

interface FollowMeState {
  /** Is Follow-Me actively enabled */
  isFollowing: boolean;
  /** Is Follow-Me temporarily paused (e.g., after user pan) */
  isPaused: boolean;
  /** Resume Follow-Me and clear pause state */
  resume: () => void;
  /** Pause Follow-Me for PAUSE_DURATION */
  pause: () => void;
  /** Enable/disable Follow-Me globally */
  setFollowing: (enabled: boolean) => void;
}

export const useFollowMeStore = create<FollowMeState>((set, get) => {
  let pauseTimer: number | null = null;

  return {
    isFollowing: true,
    isPaused: false,

    resume: () => {
      if (pauseTimer !== null) {
        if (typeof window !== 'undefined') {
          window.clearTimeout(pauseTimer);
        }
        pauseTimer = null;
      }
      set({ isPaused: false });
    },

    pause: () => {
      // Cancel existing timer
      if (pauseTimer !== null) {
        window.clearTimeout(pauseTimer);
      }

      set({ isPaused: true });

      // Auto-resume after PAUSE_DURATION
      if (typeof window !== 'undefined') {
        pauseTimer = window.setTimeout(() => {
          pauseTimer = null;
          get().resume();
        }, PAUSE_DURATION);
      }
    },

    setFollowing: (enabled: boolean) => {
      set({ isFollowing: enabled, isPaused: false });
      if (pauseTimer !== null) {
        if (typeof window !== 'undefined') {
          window.clearTimeout(pauseTimer);
        }
        pauseTimer = null;
      }
    },
  };
});

declare global {
  interface Window {
    /**
     * Debug/E2E-Zugriff, wie `__yapaiaMapController` (map/MapView.tsx) und
     * `__yapaiaPositionStore` (position/positionStore.ts): damit Playwright
     * den Pausen-Zustand direkt lesen kann, statt ihn aus der Sichtbarkeit
     * eines Knopfes zu erschliessen. Seit der Re-Center-Knopf nicht mehr an
     * der Pause haengt (0.3.3), waere dieser Umweg schlicht falsch.
     * Nur lesend gedacht -- Produktionscode geht weiter ueber die Hooks.
     */
    __yapaiaFollowMeStore?: typeof useFollowMeStore;
  }
}

if (typeof window !== 'undefined') {
  window.__yapaiaFollowMeStore = useFollowMeStore;
}

/**
 * Hooks
 */
export function useFollowMe(): boolean {
  return useFollowMeStore((state) => state.isFollowing && !state.isPaused);
}

export function useFollowMeIsPaused(): boolean {
  return useFollowMeStore((state) => state.isPaused);
}

export function useResumeFollowMe(): () => void {
  return useFollowMeStore((state) => state.resume);
}

/**
 * Initialize Follow-Me tracking:
 * - Listens for map dragstart/movestart with originalEvent to detect user pan
 *
 * Call this once in a useEffect in your main map component.
 * Position tracking is handled via useEffect hook in the component.
 */
export function initializeFollowMe(): () => void {
  const map = mapController.getMap();
  if (!map) {
    return () => {}; // Cleanup no-op if map not ready
  }

  // Handler for user pan/drag (dragstart/movestart with originalEvent)
  const handleUserInteraction = (e: Record<string, unknown>) => {
    // Only pause if it was a user interaction (originalEvent exists)
    if (e.originalEvent) {
      useFollowMeStore.getState().pause();
    }
  };

  // Listen to map drag/move events
  mapController.on('dragstart', handleUserInteraction);
  mapController.on('movestart', handleUserInteraction);

  // Cleanup function
  return () => {
    mapController.off('dragstart', handleUserInteraction);
    mapController.off('movestart', handleUserInteraction);
  };
}

/**
 * Zurück zur aktuellen Position — auf ausdrücklichen Wunsch, nicht als
 * Nebenwirkung.
 *
 * ─── WARUM DAS NICHT SCHON DA WAR ──────────────────────────────────────────
 * `updateFollowMePosition` zieht die Karte nur mit, wenn eine NEUE Position
 * eintrifft. Wer nach einer Suche über die Karte gewandert ist, wartet also
 * auf den nächsten Fix — bei der Companion App können das Minuten sein. Und
 * der Re-Center-Knopf erschien bis 0.3.2 nur nach einem MANUELLEN Schwenk:
 * `flyTo` aus der Suche ist eine programmatische Bewegung und pausiert
 * Follow-Me gerade nicht, der Knopf blieb also aus. Wer suchte, hatte keinen
 * Weg zurück außer selbst hinzuscrollen.
 *
 * Diese Funktion tut beides auf einmal: Pause aufheben UND sofort zentrieren.
 * `false`, wenn es gar keine Position gibt — dann gibt es auch nichts, wohin
 * man zurückkehren könnte, und der Knopf wird gar nicht erst angeboten.
 */
export function recenterOnPosition(): boolean {
  useFollowMeStore.getState().resume();
  const position = usePositionStore.getState().position;
  if (!position) {
    return false;
  }

  // ─── ZOOM: HERAN, ABER NIE WEG ────────────────────────────────────────────
  // Nur zu zentrieren war zu wenig: wer über die Karte gewandert ist, hat
  // meist auch herausgezoomt und landet dann zwar an der richtigen Stelle,
  // aber in einer Übersicht, in der die eigene Straße nicht zu erkennen ist.
  //
  // `Math.max` und nicht ein fester Wert: wer bereits NÄHER dran ist, würde
  // sonst beim Zurückkehren hinausgezoomt — eine Bewegung, die niemand
  // angefordert hat und die im Fahrzeug besonders stört. Der Knopf holt also
  // heran, wenn nötig, und lässt sonst in Ruhe.
  const current = mapController.getMap()?.getZoom();
  const zoom =
    typeof current === 'number' && Number.isFinite(current)
      ? Math.max(current, RECENTER_MIN_ZOOM)
      : RECENTER_MIN_ZOOM;

  mapController.setCamera({ center: [position.lon, position.lat], zoom });
  return true;
}

/**
 * Update map center to follow current position (if following and not paused).
 * Call this from a useEffect that depends on position updates.
 */
/**
 * Wie lange die Kamera fuer den Weg zur neuen Position brauchen soll.
 *
 * ─── DIE MELDUNG ──────────────────────────────────────────────────────────
 * „Das Abfahren der Route passiert sprunghaft. Der Route wird nicht fluessig
 * gefolgt sondern immer in Schritten."
 *
 * ─── DIE URSACHE ──────────────────────────────────────────────────────────
 * `setCamera` SPRINGT standardmaessig (`jumpTo`). Positionen kommen im
 * Sekundentakt -- also ein Sprung pro Sekunde, genau das beschriebene
 * Stufenmuster.
 *
 * ─── WARUM DIE DAUER MITWANDERT ───────────────────────────────────────────
 * Die Bewegung dauert ungefaehr so lange, wie zwischen den letzten beiden
 * Meldungen vergangen ist -- dann kommt sie gerade an, wenn die naechste
 * eintrifft. Eine feste Sekunde waere falsch, sobald sich die Melderate
 * aendert (`positionService` erlaubt bis 5 Hz), und die Kamera hinge dauernd
 * hinterher.
 *
 * Bei sehr langen Abstaenden wird gedeckelt -- nach einer Pause (GPS-Ausfall,
 * App im Hintergrund) soll die Karte nicht minutenlang kriechen.
 *
 * ─── EINE KORREKTUR ────────────────────────────────────────────────────────
 * Hier stand, im Zeitraffer traefen die Meldungen „alle ~31 ms" ein, und
 * `MIN_ANIMATE_MS` faenge das ab. Das ist NACHGEMESSEN falsch: der Core gibt
 * Positionen mit hoechstens `rateHz` weiter (Vorgabe 1 Hz,
 * `position/service.ts#publishThrottled`), unabhaengig vom Zeitraffer. Im
 * Browser kommt also auch bei 32x rund eine Meldung je Sekunde an -- sie
 * liegt nur weiter auseinander (bei 50 km/h rund 440 m statt 13,9 m).
 *
 * Die untere Grenze bleibt trotzdem: bei einer Melderate von 5 Hz und einem
 * Buendel nach einer Wiederverbindung koennen zwei Meldungen dicht
 * aufeinander folgen, und eine Animation ueber wenige Millisekunden kostet
 * mehr, als sie glaettet. Sie steht jetzt nur nicht mehr mit einer
 * Begruendung da, die es so nicht gibt.
 */
export const MIN_ANIMATE_MS = 60;
export const MAX_ANIMATE_MS = 1500;

export function followAnimationMs(sinceLastFixMs: number | null): number | null {
  if (sinceLastFixMs === null || !Number.isFinite(sinceLastFixMs)) return null;
  if (sinceLastFixMs < MIN_ANIMATE_MS) return null; // springen
  return Math.min(sinceLastFixMs, MAX_ANIMATE_MS);
}

/** Wann zuletzt eine Position die Kamera bewegt hat. */
let lastFollowAtMs: number | null = null;

/** Nur fuer Tests: den Takt vergessen, als haette es keine Meldung gegeben. */
export function resetFollowCadence(): void {
  lastFollowAtMs = null;
}

export function updateFollowMePosition(): void {
  const { isFollowing, isPaused } = useFollowMeStore.getState();
  if (!isFollowing || isPaused) {
    return;
  }

  const position = usePositionStore.getState().position;
  if (!position) return;

  // ─── AUTOMATISCHER ZOOM (0.5.7) ───────────────────────────────────────────
  // Bewusst HIER und nicht als eigener Beobachter: an dieser Stelle ist die
  // Frage „darf die Kamera ueberhaupt bewegt werden?" bereits beantwortet.
  // Ein zweiter Weg zur Kamera muesste dieselbe Pruefung noch einmal treffen
  // -- und irgendwann treffen zwei Pruefungen unterschiedliche Antworten.
  //
  // Der manuelle Schwenk pausiert Follow-Me fuer 10 s (siehe oben) und
  // schaltet damit auch den Auto-Zoom ab. Das ist die Zusicherung, die diese
  // Funktion braucht: der Mensch gewinnt immer.
  const zoom = nextAutoZoom();

  // ─── FLUESSIG STATT SPRUNGHAFT ────────────────────────────────────────────
  // Siehe `followAnimationMs`: die Bewegung dauert ungefaehr so lange wie der
  // Abstand zur vorigen Meldung, damit sie ankommt, wenn die naechste kommt.
  const jetzt = Date.now();
  const dauer = followAnimationMs(lastFollowAtMs === null ? null : jetzt - lastFollowAtMs);
  lastFollowAtMs = jetzt;

  mapController.setCamera(
    zoom === null
      ? { center: [position.lon, position.lat] }
      : { center: [position.lon, position.lat], zoom },
    dauer === null ? undefined : { animate: true, duration: dauer },
  );
}

/**
 * Den Auto-Zoom SOFORT anwenden, ohne auf die naechste Position zu warten.
 *
 * ─── DIE MELDUNG ──────────────────────────────────────────────────────────
 * „Der Zoom wirkt noch nicht ausgereift. Insbesondere bei Start ist noch
 * recht weit rausgezoomt. Da waere es besser wenn man die naechsten Strassen
 * deutlicher sieht."
 *
 * ─── DIE URSACHE WAR DER ZEITPUNKT, NICHT DIE STUFE ───────────────────────
 * Bei Stillstand waere die Stufe bereits die dichteste. Der Auto-Zoom hing
 * aber ausschliesslich an `updateFollowMePosition`, und die laeuft erst,
 * wenn eine NEUE Position eintrifft. Beim Losfahren blieb also die
 * Uebersicht stehen, in der man die Route geplant hatte -- bis zur naechsten
 * Meldung, und mit ihr die ganze erste Abbiegung.
 *
 * Aufgerufen wird das beim Beginn einer Fahrt (siehe `DriveOverlay`). Die
 * Pausenregel gilt unveraendert: wer die Karte gerade selbst angefasst hat,
 * behaelt sie.
 */
export function applyAutoZoomNow(): void {
  const { isFollowing, isPaused } = useFollowMeStore.getState();
  if (!isFollowing || isPaused) return;

  const position = usePositionStore.getState().position;
  if (!position) return;

  const zoom = nextAutoZoom();
  if (zoom === null) return;

  mapController.setCamera({ center: [position.lon, position.lat], zoom });
}

/**
 * Die Zoomstufe, auf die der Auto-Zoom stellen soll -- oder `null` fuer
 * „unveraendert lassen".
 *
 * Nur waehrend einer laufenden Fahrt: ausserhalb hat niemand eine Anweisung
 * gegeben, die eine Kamerabewegung rechtfertigt.
 */
function nextAutoZoom(): number | null {
  const navState = useNavStore.getState().navState;
  if (!isDriveActive(navState?.status)) return null;

  const target = autoZoomFor({
    speedKmh: navState?.speed_kmh,
    distanceToManeuverM: navState?.distance_to_maneuver_m,
  });
  if (target === null) return null;

  return shouldApplyZoom(mapController.getMap()?.getZoom(), target) ? target : null;
}
