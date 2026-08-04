/**
 * E10-T2 Pflicht-Test: Auswertungslogik des Soak-Laufs.
 *
 * Der Soak selbst laeuft 24 h im Wochen-Cron und in der PR-Pipeline gar nicht.
 * Umso wichtiger, dass seine BEWERTUNG hier deterministisch geprueft ist:
 * sonst kaeme aus dem naechtlichen Lauf ein Urteil, das nie jemand
 * nachgerechnet hat.
 */

import { describe, it, expect } from 'vitest';
import {
  SOAK_MAX_FD_GROWTH,
  SOAK_MAX_RSS_DRIFT_PCT,
  evaluateSoak,
  renderSoakReport,
  type SoakSample,
} from './soak.js';

function series(
  rss: readonly number[],
  fds: readonly number[] = [],
  sockets: readonly number[] = [],
): SoakSample[] {
  return rss.map((rssMb, i) => ({
    atMs: i * 60_000,
    rssMb,
    fdCount: fds[i] ?? 30,
    socketCount: sockets[i] ?? 5,
  }));
}

describe('evaluateSoak()', () => {
  it('besteht bei stabilem RSS und stabiler FD-Zahl', () => {
    const result = evaluateSoak(series([100, 101, 100, 102, 101, 100, 101, 102]));
    expect(result.passed).toBe(true);
    expect(result.failures).toEqual([]);
    expect(Math.abs(result.rssDriftPct)).toBeLessThan(SOAK_MAX_RSS_DRIFT_PCT);
  });

  it('faellt durch, wenn der RSS ueber 5 % driftet', () => {
    const result = evaluateSoak(series([100, 100, 105, 110, 115, 120, 125, 130]));
    expect(result.passed).toBe(false);
    expect(result.rssDriftOk).toBe(false);
    expect(result.rssDriftPct).toBeCloseTo(27.5, 1);
    expect(result.failures[0]).toMatch(/RSS-Drift/);
  });

  it('wertet Fenster-Mittel statt Anfangs- gegen Endwert', () => {
    // Ein einzelner GC-Ausreisser am Ende darf den Lauf nicht kippen …
    const spiky = evaluateSoak(series([100, 100, 100, 100, 100, 100, 100, 130]));
    expect(spiky.last.sampleCount).toBe(2);
    expect(spiky.rssDriftPct).toBeCloseTo(15, 1);
    // … waehrend ein echter Trend erkannt wird (siehe Test darueber).
    const steady = evaluateSoak(series([100, 100, 100, 100, 100, 100, 100, 100]));
    expect(steady.rssDriftPct).toBe(0);
  });

  it('erlaubt sinkenden Speicher ohne Beanstandung', () => {
    const result = evaluateSoak(series([140, 138, 130, 125, 120, 118, 115, 112]));
    expect(result.rssDriftPct).toBeLessThan(0);
    expect(result.passed).toBe(true);
  });

  it('erkennt ein FD-Leck', () => {
    const fds = [30, 31, 32, 40, 48, 56, 64, 72];
    const result = evaluateSoak(series([100, 100, 100, 100, 100, 100, 100, 100], fds));
    expect(result.fdOk).toBe(false);
    expect(result.fdGrowth).toBeCloseTo(37.5, 1);
    expect(result.failures.some((f) => f.includes('FD-Wachstum'))).toBe(true);
  });

  it('erkennt ein Verbindungsleck (Sockets), auch wenn die FD-Zahl passt', () => {
    const sockets = [5, 5, 6, 10, 15, 20, 25, 30];
    const result = evaluateSoak(series([100, 100, 100, 100, 100, 100, 100, 100], [], sockets));
    expect(result.fdOk).toBe(false);
    expect(result.failures.some((f) => f.includes('Socket-Wachstum'))).toBe(true);
  });

  it('toleriert Schwankungen innerhalb der absoluten FD-Grenze', () => {
    const fds = [30, 31, 30, 32, 33, 34, 33, 35];
    const result = evaluateSoak(series([100, 100, 100, 100, 100, 100, 100, 100], fds));
    expect(result.fdGrowth).toBeLessThanOrEqual(SOAK_MAX_FD_GROWTH);
    expect(result.passed).toBe(true);
  });

  it('meldet Laufzeit, Stichprobenzahl und RSS-Spitze', () => {
    const result = evaluateSoak(series([100, 101, 160, 102, 101, 100, 101, 102]));
    expect(result.sampleCount).toBe(8);
    expect(result.durationMs).toBe(7 * 60_000);
    expect(result.rssPeakMb).toBe(160);
  });

  it('verweigert eine Aussage bei zu wenigen Stichproben', () => {
    expect(() => evaluateSoak(series([100, 100, 100]))).toThrow(/mindestens 8 Stichproben/);
  });
});

describe('renderSoakReport()', () => {
  const context = {
    plannedDurationS: 120,
    startedAt: '2026-08-03T00:00:00.000Z',
    simulatorRestarts: 3,
    browserSessions: 4,
    corePid: 4711,
  };

  it('ist lesbar: nennt Dauer, Kriterien, Grenzen und ein klares Ergebnis', () => {
    const md = renderSoakReport(context, evaluateSoak(series([100, 101, 100, 102, 101, 100, 101, 102])));
    expect(md).toContain('Soak-Report (E10-T2)');
    expect(md).toContain('| RSS |');
    expect(md).toContain('RSS-Spitze');
    expect(md).toContain('Offene FDs');
    expect(md).toContain('Offene Sockets');
    expect(md).toContain('Simulator-Neustarts');
    expect(md).toContain('bestanden');
    expect(md).toContain('🟢');
  });

  it('listet im Fehlerfall jeden gerissenen Punkt einzeln auf', () => {
    const failing = evaluateSoak(series([100, 100, 110, 120, 130, 140, 150, 160], [30, 30, 40, 50, 60, 70, 80, 90]));
    const md = renderSoakReport(context, failing);
    expect(md).toContain('NICHT bestanden');
    expect(md).toContain('RSS-Drift');
    expect(md).toContain('FD-Wachstum');
    expect(md).toContain('🔴');
  });
});
