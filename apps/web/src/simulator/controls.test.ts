/**
 * Die Regeln der Simulator-Bedienung.
 *
 * Gemeldet: „(2x, 4x, 8x, 16x, 32x und zurueck) eventuell als
 * Schieberegler."
 */

import { describe, it, expect } from 'vitest';
import type { SimulatorStatus } from './client.js';
import {
  SPEED_STEPS,
  controlAvailability,
  formatSimSeconds,
  playbackProgress,
  speedStepIndex,
  speedStepLabel,
} from './controls.js';

function status(overrides: Partial<SimulatorStatus> = {}): SimulatorStatus {
  return {
    state: 'playing',
    trackDescription: 'route:r1 (0/10 Abschnitte ohne Limit)',
    tickS: 30,
    totalDurationS: 120,
    speedFactor: 1,
    ...overrides,
  };
}

describe('die Stufen des Zeitraffers', () => {
  it('enthalten die gemeldeten Werte', () => {
    for (const gewuenscht of [2, 4, 8, 16, 32]) {
      expect(SPEED_STEPS).toContain(gewuenscht);
    }
  });

  it('enthalten auch 1x -- „und zurueck"', () => {
    // Ohne 1x kaeme man nie wieder auf Echtzeit herunter.
    expect(SPEED_STEPS[0]).toBe(1);
  });

  it('sind aufsteigend, damit der Regler nach rechts schneller wird', () => {
    for (let i = 1; i < SPEED_STEPS.length; i += 1) {
      expect(SPEED_STEPS[i]).toBeGreaterThan(SPEED_STEPS[i - 1]);
    }
  });

  it('jede Stufe findet ihren eigenen Reglerplatz', () => {
    SPEED_STEPS.forEach((factor, index) => {
      expect(speedStepIndex(factor)).toBe(index);
    });
  });

  it('ein Zwischenwert landet auf der naechstgelegenen Stufe', () => {
    // Der Server darf begrenzen und meldet den TATSAECHLICHEN Faktor. Ein
    // Regler, der auf einer Stufe steht, die gar nicht laeuft, waere
    // schlimmer als ein ungenauer.
    expect(speedStepIndex(15)).toBe(SPEED_STEPS.indexOf(16));
    expect(speedStepIndex(100)).toBe(SPEED_STEPS.length - 1);
    expect(speedStepIndex(0.1)).toBe(0);
  });

  it('ein unbrauchbarer Wert landet auf 1x statt irgendwo', () => {
    expect(speedStepIndex(Number.NaN)).toBe(0);
  });

  it('werden mit einem Mal-Zeichen beschriftet', () => {
    expect(speedStepLabel(8)).toBe('8×');
  });
});

describe('welche Knoepfe etwas bewirken', () => {
  it('ohne Route laesst sich nicht starten', () => {
    // Der haeufigste Fall beim ersten Oeffnen -- und der Grund fuer den
    // Hinweis daneben.
    expect(controlAvailability(null, null).canPlay).toBe(false);
    expect(controlAvailability(null, 'r1').canPlay).toBe(true);
  });

  it('waehrend der Fahrt: Pause und Stopp, kein Weiter', () => {
    const can = controlAvailability(status({ state: 'playing' }), 'r1');
    expect(can.canPause).toBe(true);
    expect(can.canStop).toBe(true);
    expect(can.canResume).toBe(false);
  });

  it('in der Pause: Weiter und Stopp, kein Pause', () => {
    const can = controlAvailability(status({ state: 'paused' }), 'r1');
    expect(can.canResume).toBe(true);
    expect(can.canStop).toBe(true);
    expect(can.canPause).toBe(false);
  });

  it('ohne laufende Strecke gibt es nichts anzuhalten', () => {
    for (const state of ['idle', 'stopped'] as const) {
      const can = controlAvailability(status({ state }), 'r1');
      expect(can.canPause).toBe(false);
      expect(can.canStop).toBe(false);
      expect(can.canResume).toBe(false);
    }
  });

  it('der Zeitraffer laesst sich auch in der Pause vorwaehlen', () => {
    // Die Stufe gilt dann ab dem naechsten „Weiter" -- ohne dass die Pause
    // dadurch aufgehoben wird.
    expect(controlAvailability(status({ state: 'paused' }), 'r1').canChangeSpeed).toBe(true);
  });

  it('aber nicht, wenn gar nichts geladen ist', () => {
    expect(controlAvailability(status({ state: 'idle' }), 'r1').canChangeSpeed).toBe(false);
    expect(controlAvailability(null, 'r1').canChangeSpeed).toBe(false);
  });
});

describe('der Fortschritt', () => {
  it('ist der Anteil der abgefahrenen simulierten Zeit', () => {
    expect(playbackProgress(status({ tickS: 30, totalDurationS: 120 }))).toBeCloseTo(0.25, 6);
  });

  it('ueberschreitet nie 1', () => {
    // Der letzte Tick kann ueber die Gesamtdauer hinauslaufen -- ein Balken,
    // der aus seinem Rahmen laeuft, sieht kaputt aus.
    expect(playbackProgress(status({ tickS: 500, totalDurationS: 120 }))).toBe(1);
  });

  it('ist ohne bekannte Gesamtdauer „keine Angabe" und nicht 0', () => {
    // Ein Balken auf Null behauptet, es ginge gerade los.
    expect(playbackProgress(status({ totalDurationS: null }))).toBeNull();
    expect(playbackProgress(status({ totalDurationS: 0 }))).toBeNull();
    expect(playbackProgress(null)).toBeNull();
  });

  it('auch bei unbrauchbaren Werten', () => {
    expect(playbackProgress(status({ tickS: Number.NaN }))).toBeNull();
    expect(playbackProgress(status({ tickS: -5 }))).toBeNull();
  });
});

describe('die Zeitangabe', () => {
  it('Minuten und Sekunden', () => {
    expect(formatSimSeconds(0)).toBe('0:00');
    expect(formatSimSeconds(65)).toBe('1:05');
  });

  it('mit Stunden, wenn noetig', () => {
    expect(formatSimSeconds(3_725)).toBe('1:02:05');
  });

  it('ein fehlender Wert bleibt ein Gedankenstrich, keine 0:00', () => {
    expect(formatSimSeconds(null)).toBe('–');
    expect(formatSimSeconds(undefined)).toBe('–');
    expect(formatSimSeconds(Number.NaN)).toBe('–');
    expect(formatSimSeconds(-1)).toBe('–');
  });
});
