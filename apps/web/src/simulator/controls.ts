/**
 * Die Regeln der Simulator-Bedienung -- ohne React, damit sie ohne Rendern
 * pruefbar sind.
 *
 * Gemeldet: „(2x, 4x, 8x, 16x, 32x und zurueck) eventuell als
 * Schieberegler."
 *
 * Ein Schieberegler mit STUFEN und nicht stufenlos: die gewuenschten Werte
 * verdoppeln sich, ein linearer Regler haette den ganzen unteren Bereich auf
 * wenigen Punkten zusammengedraengt und 32x am aeussersten Rand gehabt. Der
 * Regler laeuft deshalb ueber den INDEX der Stufe, nicht ueber den Faktor.
 */

import type { SimulatorStatus } from './client.js';

/** „und zurueck" heisst: 1x gehoert dazu, sonst kaeme man nie wieder runter. */
export const SPEED_STEPS = [1, 2, 4, 8, 16, 32] as const;

export function speedStepLabel(factor: number): string {
  return `${factor}×`;
}

/**
 * Der Reglerplatz zu einem Faktor.
 *
 * Der Server darf den Faktor begrenzen (er kennt seine eigenen Grenzen), und
 * gemeldet wird immer der TATSAECHLICHE Wert. Liegt der zwischen zwei
 * Stufen, wird die naechstgelegene angezeigt -- ein Regler, der auf einer
 * Stufe steht, die nicht laeuft, waere schlimmer als ein ungenauer.
 */
export function speedStepIndex(factor: number): number {
  if (!Number.isFinite(factor)) return 0;
  let best = 0;
  for (let i = 1; i < SPEED_STEPS.length; i += 1) {
    if (Math.abs(SPEED_STEPS[i] - factor) < Math.abs(SPEED_STEPS[best] - factor)) best = i;
  }
  return best;
}

/** Laeuft gerade eine Wiedergabe (auch pausiert)? */
export function hasTrack(status: SimulatorStatus | null): boolean {
  return status !== null && (status.state === 'playing' || status.state === 'paused');
}

export interface ControlAvailability {
  /** „Route abfahren" -- braucht eine Route, sonst gibt es nichts zu fahren. */
  canPlay: boolean;
  canPause: boolean;
  canResume: boolean;
  canStop: boolean;
  /** Der Zeitraffer-Regler. */
  canChangeSpeed: boolean;
}

/**
 * Welche Bedienelemente gerade etwas bewirken.
 *
 * Ausgegraut statt versteckt: ein Knopf, der verschwindet und wiederkommt,
 * laesst die Oberflaeche springen. Und wer nicht starten kann, soll sehen,
 * dass es den Knopf gibt -- die Begruendung steht daneben.
 */
export function controlAvailability(
  status: SimulatorStatus | null,
  activeRouteId: string | null,
): ControlAvailability {
  const playing = status?.state === 'playing';
  const paused = status?.state === 'paused';
  return {
    canPlay: activeRouteId !== null,
    canPause: playing,
    canResume: paused,
    canStop: playing || paused,
    // Auch im Pausenzustand: die Stufe laesst sich vorwaehlen, bevor es
    // weitergeht. Der Server merkt sie sich, ohne die Pause aufzuheben.
    canChangeSpeed: playing || paused,
  };
}

/**
 * Fortschritt als Anteil [0, 1] -- oder `null`, wenn er sich nicht bestimmen
 * laesst.
 *
 * `null` heisst „keine Angabe", nicht 0: ein Balken, der bei einer
 * unbekannten Gesamtdauer auf Null steht, behauptet, es ginge gerade los.
 */
export function playbackProgress(status: SimulatorStatus | null): number | null {
  if (!status) return null;
  const total = status.totalDurationS;
  if (typeof total !== 'number' || !Number.isFinite(total) || total <= 0) return null;
  if (!Number.isFinite(status.tickS) || status.tickS < 0) return null;
  return Math.min(1, status.tickS / total);
}

/** „1:23:45" bzw. „4:05" -- simulierte Sekunden als Uhrzeitdauer. */
export function formatSimSeconds(seconds: number | null | undefined): string {
  if (typeof seconds !== 'number' || !Number.isFinite(seconds) || seconds < 0) return '–';
  const total = Math.floor(seconds);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const mm = String(m).padStart(h > 0 ? 2 : 1, '0');
  const ss = String(s).padStart(2, '0');
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}
