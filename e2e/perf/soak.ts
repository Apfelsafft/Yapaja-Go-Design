/**
 * E10-T2 -- Auswertung des Dauerlauf-Tests (Soak). PUR, unit-getestet
 * (`soak.test.ts`).
 *
 * Kriterien aus der Aufgabenstellung: "Simulator-Dauerfahrt, RSS-Drift < 5 %,
 * keine Verbindungs-/FD-Lecks."
 *
 * RSS-DRIFT: verglichen wird das MITTEL des ersten Viertels der Messreihe mit
 * dem MITTEL des letzten Viertels -- nicht Anfangs- gegen Endwert. Ein
 * Einzelwert am Anfang faellt in die Aufwaermphase (JIT, Lazy-Init, erste
 * GC-Zyklen), ein Einzelwert am Ende kann direkt vor oder nach einer GC
 * liegen. Fensterweise Mittelung ist die Messgroesse, die "waechst der
 * Speicher ueber die Zeit" tatsaechlich beantwortet.
 *
 * FD-/VERBINDUNGSLECK: waehrend des Laufs werden wiederholt Browser-Kontexte
 * geoeffnet und geschlossen, also WS-Verbindungen auf- und abgebaut. Ein Leck
 * zeigt sich als monoton wachsende Zahl offener Sockets bzw. FDs. Verglichen
 * werden wieder erstes gegen letztes Viertel; die Toleranz ist ABSOLUT
 * (Anzahl FDs), weil ein relativer Prozentsatz bei einer Basis von ~30 FDs
 * bedeutungslos waere.
 */

export interface SoakSample {
  /** Millisekunden seit Beginn des Laufs. */
  readonly atMs: number;
  readonly rssMb: number;
  readonly fdCount: number;
  readonly socketCount: number;
}

export const SOAK_MAX_RSS_DRIFT_PCT = 5;
/** Absolute Toleranz fuer FDs/Sockets zwischen erstem und letztem Viertel. */
export const SOAK_MAX_FD_GROWTH = 8;

export interface SoakWindowStats {
  readonly rssMb: number;
  readonly fdCount: number;
  readonly socketCount: number;
  readonly sampleCount: number;
}

export interface SoakEvaluation {
  readonly durationMs: number;
  readonly sampleCount: number;
  readonly first: SoakWindowStats;
  readonly last: SoakWindowStats;
  readonly rssDriftPct: number;
  readonly rssPeakMb: number;
  readonly fdGrowth: number;
  readonly socketGrowth: number;
  readonly rssDriftOk: boolean;
  readonly fdOk: boolean;
  readonly passed: boolean;
  readonly failures: readonly string[];
}

function average(values: readonly number[]): number {
  return values.reduce((sum, v) => sum + v, 0) / values.length;
}

function windowStats(samples: readonly SoakSample[]): SoakWindowStats {
  return {
    rssMb: average(samples.map((s) => s.rssMb)),
    fdCount: average(samples.map((s) => s.fdCount)),
    socketCount: average(samples.map((s) => s.socketCount)),
    sampleCount: samples.length,
  };
}

/**
 * Wertet eine Soak-Messreihe aus.
 *
 * Verlangt mindestens 8 Stichproben -- darunter waeren "erstes Viertel" und
 * "letztes Viertel" je ein bis zwei Punkte, und eine Driftaussage darueber
 * waere Rauschen mit Nachkommastellen.
 */
export function evaluateSoak(
  samples: readonly SoakSample[],
  maxDriftPct: number = SOAK_MAX_RSS_DRIFT_PCT,
  maxFdGrowth: number = SOAK_MAX_FD_GROWTH,
): SoakEvaluation {
  if (samples.length < 8) {
    throw new Error(
      `evaluateSoak(): mindestens 8 Stichproben noetig, bekam ${samples.length} -- ` +
        'darunter ist eine Driftaussage nicht belastbar.',
    );
  }
  const quarter = Math.max(1, Math.floor(samples.length / 4));
  const first = windowStats(samples.slice(0, quarter));
  const last = windowStats(samples.slice(samples.length - quarter));

  const rssDriftPct = first.rssMb === 0 ? 0 : ((last.rssMb - first.rssMb) / first.rssMb) * 100;
  const fdGrowth = last.fdCount - first.fdCount;
  const socketGrowth = last.socketCount - first.socketCount;

  const rssDriftOk = rssDriftPct <= maxDriftPct;
  const fdOk = fdGrowth <= maxFdGrowth && socketGrowth <= maxFdGrowth;

  const failures: string[] = [];
  if (!rssDriftOk) {
    failures.push(
      `RSS-Drift ${rssDriftPct.toFixed(2)} % > ${maxDriftPct} % ` +
        `(${first.rssMb.toFixed(1)} MB -> ${last.rssMb.toFixed(1)} MB)`,
    );
  }
  if (fdGrowth > maxFdGrowth) {
    failures.push(
      `FD-Wachstum ${fdGrowth.toFixed(1)} > ${maxFdGrowth} ` +
        `(${first.fdCount.toFixed(1)} -> ${last.fdCount.toFixed(1)})`,
    );
  }
  if (socketGrowth > maxFdGrowth) {
    failures.push(
      `Socket-Wachstum ${socketGrowth.toFixed(1)} > ${maxFdGrowth} ` +
        `(${first.socketCount.toFixed(1)} -> ${last.socketCount.toFixed(1)})`,
    );
  }

  return {
    durationMs: samples[samples.length - 1].atMs - samples[0].atMs,
    sampleCount: samples.length,
    first,
    last,
    rssDriftPct,
    rssPeakMb: Math.max(...samples.map((s) => s.rssMb)),
    fdGrowth,
    socketGrowth,
    rssDriftOk,
    fdOk,
    passed: rssDriftOk && fdOk,
    failures,
  };
}

export interface SoakContext {
  /** Tatsaechlich gelaufene Dauer in Sekunden (Soll). */
  readonly plannedDurationS: number;
  readonly startedAt: string;
  readonly simulatorRestarts: number;
  readonly browserSessions: number;
  readonly corePid: number;
}

/** Der lesbare Report (Akzeptanzkriterium 3: "Soak-Report ist lesbar"). */
export function renderSoakReport(context: SoakContext, evaluation: SoakEvaluation): string {
  const lines: string[] = [];
  const hours = (evaluation.durationMs / 3_600_000).toFixed(2);
  lines.push(`# ${evaluation.passed ? '🟢' : '🔴'} Soak-Report (E10-T2)`);
  lines.push('');
  lines.push(`- **Start:** ${context.startedAt}`);
  lines.push(
    `- **Dauer:** ${(evaluation.durationMs / 1000).toFixed(0)} s (${hours} h), geplant ${context.plannedDurationS} s`,
  );
  lines.push(`- **Stichproben:** ${evaluation.sampleCount}`);
  lines.push(`- **Core-PID:** ${context.corePid}`);
  lines.push(`- **Simulator-Neustarts (Dauerfahrt):** ${context.simulatorRestarts}`);
  lines.push(`- **Browser-Sitzungen auf/zu (WS-Verbindungstest):** ${context.browserSessions}`);
  lines.push('');
  lines.push('| Kriterium | Erstes Viertel | Letztes Viertel | Änderung | Grenze | Status |');
  lines.push('|---|---:|---:|---:|---:|:--:|');
  lines.push(
    `| RSS | ${evaluation.first.rssMb.toFixed(1)} MB | ${evaluation.last.rssMb.toFixed(1)} MB | ` +
      `${evaluation.rssDriftPct >= 0 ? '+' : ''}${evaluation.rssDriftPct.toFixed(2)} % | < ${SOAK_MAX_RSS_DRIFT_PCT} % | ` +
      `${evaluation.rssDriftOk ? '🟢' : '🔴'} |`,
  );
  lines.push(
    `| Offene FDs | ${evaluation.first.fdCount.toFixed(1)} | ${evaluation.last.fdCount.toFixed(1)} | ` +
      `${evaluation.fdGrowth >= 0 ? '+' : ''}${evaluation.fdGrowth.toFixed(1)} | ≤ ${SOAK_MAX_FD_GROWTH} | ` +
      `${evaluation.fdGrowth <= SOAK_MAX_FD_GROWTH ? '🟢' : '🔴'} |`,
  );
  lines.push(
    `| Offene Sockets | ${evaluation.first.socketCount.toFixed(1)} | ${evaluation.last.socketCount.toFixed(1)} | ` +
      `${evaluation.socketGrowth >= 0 ? '+' : ''}${evaluation.socketGrowth.toFixed(1)} | ≤ ${SOAK_MAX_FD_GROWTH} | ` +
      `${evaluation.socketGrowth <= SOAK_MAX_FD_GROWTH ? '🟢' : '🔴'} |`,
  );
  lines.push('');
  lines.push(`**RSS-Spitze:** ${evaluation.rssPeakMb.toFixed(1)} MB`);
  lines.push('');
  if (evaluation.passed) {
    lines.push('**Ergebnis: bestanden.** Keine RSS-Drift über der Grenze, kein FD-/Verbindungsleck.');
  } else {
    lines.push('**Ergebnis: NICHT bestanden.**');
    for (const failure of evaluation.failures) {
      lines.push(`- ${failure}`);
    }
  }
  return lines.join('\n');
}
