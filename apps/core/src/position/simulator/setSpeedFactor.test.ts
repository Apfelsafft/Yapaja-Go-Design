/**
 * Zeitraffer WAEHREND der Wiedergabe umstellen.
 *
 * ─── DIE MELDUNG ────────────────────────────────────────────────────────────
 * „Und es sollte eine Art fast forward geben, um die benoetigte Zeit zu
 * verkuerzen. (2x, 4x, 8x, 16x, 32x und zurueck) eventuell als
 * Schieberegler."
 *
 * ─── WAS DARAN NEU IST ──────────────────────────────────────────────────────
 * Den Faktor gab es schon -- aber nur als Startparameter von `play()`, und
 * `play()` beginnt immer bei t=0. Ueber `play()` haette jeder Stufenwechsel
 * die Teststrecke von vorn begonnen, also genau die Zeit gekostet, die der
 * Zeitraffer sparen soll. „Und zurueck" waere damit unbenutzbar gewesen.
 *
 * Die wichtigste Zusicherung steht deshalb unten: die SIMULIERTE Zeit darf
 * beim Umschalten nicht zurueckspringen.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { EventBus } from '../../bus/index.js';
import { PositionService } from '../service.js';
import { SimulatorSource } from './index.js';

let bus: EventBus;
let service: PositionService;
let simulator: SimulatorSource;

beforeEach(() => {
  vi.useFakeTimers();
  bus = new EventBus({ isProduction: false });
  service = new PositionService({ bus, checkIntervalMs: 100, rateHz: 1 });
  simulator = new SimulatorSource(service);
  service.registerSource(simulator);
});

afterEach(() => {
  simulator.dispose();
  service.dispose();
  vi.useRealTimers();
});

describe('die Fahrt laeuft weiter', () => {
  it('die simulierte Zeit springt beim Umschalten nicht zurueck', () => {
    // DAS ist der Grund fuer die ganze Funktion. Ueber `play()` waere hier
    // wieder 0 herausgekommen -- die halbe Teststrecke noch einmal.
    simulator.play({ track: { gpxId: 'city' }, speed_factor: 1 });
    vi.advanceTimersByTime(5_000);
    const vorher = simulator.getStatus().tickS;
    expect(vorher).toBeGreaterThan(0);

    simulator.setSpeedFactor(8);

    expect(simulator.getStatus().tickS).toBe(vorher);
    expect(simulator.getStatus().state).toBe('playing');
  });

  it('nach dem Umschalten laeuft die Wiedergabe im neuen Takt weiter', () => {
    simulator.play({ track: { gpxId: 'city' }, speed_factor: 1 });
    vi.advanceTimersByTime(3_000);
    const beiUmschaltung = simulator.getStatus().tickS;

    simulator.setSpeedFactor(10);
    // Eine Sekunde Wanduhr bei 10x -- deutlich mehr simulierte Sekunden als
    // die eine, die bei 1x herausgekommen waere.
    vi.advanceTimersByTime(1_000);

    expect(simulator.getStatus().tickS - beiUmschaltung).toBeGreaterThan(1);
  });

  it('und zurueck: langsamer wird auch wieder langsamer', () => {
    simulator.play({ track: { gpxId: 'city' }, speed_factor: 32 });
    vi.advanceTimersByTime(1_000);
    const nachSchnell = simulator.getStatus().tickS;

    simulator.setSpeedFactor(1);
    vi.advanceTimersByTime(1_000);
    const nachLangsam = simulator.getStatus().tickS - nachSchnell;

    // Bei 1x kommt hoechstens eine Handvoll Ticks in einer Sekunde -- der
    // Vergleich mit dem schnellen Abschnitt ist der eigentliche Beweis.
    expect(nachLangsam).toBeLessThan(nachSchnell);
  });

  it('die Aenderung greift sofort und nicht erst nach der alten Wartezeit', () => {
    // Bei 1x steht der naechste Wecker eine Sekunde entfernt. Ohne
    // Neustellen passierte in den ersten 100 ms nach dem Umschalten auf 32x
    // gar nichts -- spuerbar genug, um wie ein Fehler auszusehen.
    simulator.play({ track: { gpxId: 'city' }, speed_factor: 1 });
    vi.advanceTimersByTime(1_000);
    const vorher = simulator.getStatus().tickS;

    simulator.setSpeedFactor(32);
    vi.advanceTimersByTime(100);

    expect(simulator.getStatus().tickS).toBeGreaterThan(vorher);
  });
});

describe('was gemeldet wird', () => {
  it('der Status nennt den tatsaechlich gesetzten Faktor', () => {
    simulator.play({ track: { gpxId: 'city' }, speed_factor: 1 });
    simulator.setSpeedFactor(16);
    expect(simulator.getStatus().speedFactor).toBe(16);
  });

  it('ein unmoeglicher Wunsch wird begrenzt, nicht uebernommen', () => {
    // Die Oberflaeche soll anzeigen koennen, was WIRKLICH laeuft -- sonst
    // steht dort eine Stufe, die es gar nicht gibt.
    simulator.play({ track: { gpxId: 'city' }, speed_factor: 1 });
    const gesetzt = simulator.setSpeedFactor(10_000);
    expect(gesetzt).toBeLessThan(10_000);
    expect(simulator.getStatus().speedFactor).toBe(gesetzt);
  });

  it('ein unbrauchbarer Wert faellt auf 1x zurueck statt die Wiedergabe anzuhalten', () => {
    simulator.play({ track: { gpxId: 'city' }, speed_factor: 4 });
    simulator.setSpeedFactor(Number.NaN);
    expect(simulator.getStatus().speedFactor).toBe(1);
    expect(simulator.getStatus().state).toBe('playing');
  });
});

describe('ausserhalb der Wiedergabe', () => {
  it('im Pausenzustand wird der Faktor gemerkt, aber nichts gestartet', () => {
    simulator.play({ track: { gpxId: 'city' }, speed_factor: 1 });
    vi.advanceTimersByTime(2_000);
    simulator.pause();
    const beiPause = simulator.getStatus().tickS;

    simulator.setSpeedFactor(16);

    expect(simulator.getStatus().speedFactor).toBe(16);
    expect(simulator.getStatus().state).toBe('paused');
    // Der entscheidende Teil: eine Pause bleibt eine Pause. Ein Regler darf
    // die Wiedergabe nicht heimlich wieder anwerfen.
    vi.advanceTimersByTime(5_000);
    expect(simulator.getStatus().tickS).toBe(beiPause);
  });

  it('ohne laufende Strecke passiert nichts Schlimmes', () => {
    expect(() => simulator.setSpeedFactor(8)).not.toThrow();
    expect(simulator.getStatus().state).toBe('idle');
  });
});
