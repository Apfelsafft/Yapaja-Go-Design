/**
 * Minimal in-memory job registry (E01-T5).
 *
 * Deliberately small: no persistence across restarts, no queueing/
 * concurrency limits, no job kinds/types beyond a status+progress+bytes
 * envelope. Region downloads are the only producer today; the shape is
 * generic enough that a future job (e.g. Valhalla graph rebuild, W-17)
 * could reuse it without changes, but we don't build that out here.
 *
 * `GET /api/v1/jobs/:id` (docs/03-api-spec.md §2) reads a JobSnapshot;
 * `DELETE /api/v1/jobs/:id` requests cancellation of a queued/running job.
 */

import { randomUUID } from 'crypto';

export type JobStatus = 'queued' | 'running' | 'done' | 'error';

export interface JobErrorInfo {
  code: string;
  message: string;
  details?: Record<string, unknown>;
}

export interface JobSnapshot {
  id: string;
  status: JobStatus;
  /** 0..1. Always 1 once status is 'done'. */
  progress: number;
  /** Bytes transferred so far (for download jobs). */
  bytes: number;
  /** Expected total bytes, if known. */
  totalBytes: number | null;
  error: JobErrorInfo | null;
  /** Kurze Statuszeile fuer Jobs ohne messbaren Fortschritt (Kachelbau,
   *  B-04). Ein Prozentwert waere dort erfunden; diese Zeile sagt
   *  stattdessen, WORAN gerade gearbeitet wird. */
  note?: string;
  /**
   * Woran gearbeitet wird — Region und Bauart.
   *
   * ─── WARUM DAS HIER STEHEN MUSS ───────────────────────────────────────
   * Gemeldet: „Wenn man von Yapaia woandershin wechselt und dann wieder
   * aufruft sind die aktuellen Fortschrittsinformationen vom Bau nicht mehr
   * sichtbar."
   *
   * Der Bau lief weiter — die Oberflaeche hatte nur vergessen, WELCHER Job
   * zu welcher Region gehoert: sie merkte sich das im Speicher des Browsers,
   * und der ist beim Verlassen der Seite weg. Ein Druck auf „bauen" sagte
   * danach „es laeuft bereits ein Bau", ohne zu zeigen, welcher.
   *
   * Dieselbe Fehlerklasse wie schon mehrfach hier: die Auskunft existiert,
   * sie ist von dort, wo der Betreiber hinsieht, nur nicht erreichbar.
   * Deshalb traegt der Job sie jetzt selbst, und die Oberflaeche kann sich
   * nach einem Neuladen wieder anhaengen.
   */
  region?: string;
  /** `kacheln` | `routing` | `suche` | `gesamt` — wofuer der Knopf
   *  gedrueckt wurde. */
  bauart?: string;
  /**
   * Beim Gesamtbau: wo im Ablauf er steht und wie lange es noch dauert.
   *
   * ─── WARUM DAS BEIM LESEN ENTSTEHT UND NICHT BEIM SCHREIBEN ─────────────
   * Die Restzeit sinkt, WAEHREND ein Schritt laeuft -- das ist die Forderung
   * „sollte sich entsprechend des Bau-Fortschritts aktualisieren". Ein Wert,
   * der nur bei Schrittwechseln gesetzt wuerde, staende zwischen zwei
   * Schritten minutenlang still und saehe aus wie ein Haenger.
   *
   * Deshalb rechnet ihn der Gesamtbau bei JEDER Abfrage neu aus (siehe
   * `setGesamtstand`). Fehlt das Feld, ist es kein Gesamtbau.
   */
  gesamt?: Gesamtstand;
  createdAt: string;
  updatedAt: string;
}

/** Wo ein Gesamtbau steht. Siehe `bauzeit.ts` fuer die Bedeutung von
 *  `restGrund`. */
export interface Gesamtstand {
  /** Der laufende Schritt, 1-basiert. */
  schritt: number;
  /** Wie viele Schritte es insgesamt sind. */
  schritte: number;
  /** Was gerade gebaut wird, in Worten. */
  schrittText: string;
  /** Verbleibende Sekunden, oder `null`, wenn nichts zu sagen ist. */
  restSekunden: number | null;
  /** `geschaetzt` | `mindestens` | `ueberfaellig` | `unbekannt`. */
  restGrund: string;
  /** Der fertige Satz zur Restzeit, oder `null`. */
  restText: string | null;
}

interface JobRecord extends JobSnapshot {
  cancelled: boolean;
  onCancel: (() => void) | null;
  /** Grobe Art des Jobs. Nur dafuer da, laufende Jobs derselben Art
   *  wiederzufinden -- siehe `findUnfinished`. */
  kind: string | null;
  /** Liefert den Stand eines Gesamtbaus -- bei jeder Abfrage neu gerufen,
   *  damit die Restzeit sinkt, waehrend ein Schritt laeuft. */
  gesamtstand: (() => Gesamtstand) | null;
}

function nowIso(): string {
  return new Date().toISOString();
}

function toSnapshot(record: JobRecord): JobSnapshot {
  // Der Gesamtstand wird hier GERUFEN, nicht gelesen: die Restzeit haengt an
  // der Uhr, und eine, die nur bei Schrittwechseln neu entstuende, stuende
  // dazwischen minutenlang still.
  //
  // Wirft er, faellt nur diese Angabe weg. Eine Fortschrittsanzeige darf
  // eine Statusabfrage nicht zu Fall bringen.
  let gesamt: Gesamtstand | undefined;
  try {
    gesamt = record.gesamtstand?.();
  } catch {
    gesamt = undefined;
  }
  return {
    id: record.id,
    status: record.status,
    progress: record.progress,
    bytes: record.bytes,
    totalBytes: record.totalBytes,
    error: record.error,
    note: record.note,
    region: record.region,
    bauart: record.bauart,
    ...(gesamt ? { gesamt } : {}),
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
  };
}

function isFinished(record: JobRecord): boolean {
  return record.status === 'done' || record.status === 'error';
}

export class JobRegistry {
  private readonly jobs = new Map<string, JobRecord>();

  /** Registers a new job in `queued` state and returns its id. `kind` ist
   *  optional und dient allein dazu, laufende Jobs derselben Art
   *  wiederzufinden (`findUnfinished`). */
  create(
    kind: string | null = null,
    /** Woran gearbeitet wird. Ohne das findet die Oberflaeche nach einem
     *  Neuladen zwar den laufenden Job, weiss aber nicht, unter welcher
     *  Region sie ihn anzeigen soll. */
    woran: { region?: string; bauart?: string } = {},
  ): string {
    const id = randomUUID();
    const timestamp = nowIso();
    this.jobs.set(id, {
      id,
      status: 'queued',
      progress: 0,
      bytes: 0,
      totalBytes: null,
      error: null,
      cancelled: false,
      onCancel: null,
      kind,
      gesamtstand: null,
      region: woran.region,
      bauart: woran.bauart,
      createdAt: timestamp,
      updatedAt: timestamp,
    });
    return id;
  }

  /**
   * Der aelteste noch nicht beendete Job dieser Art, falls es einen gibt.
   *
   * Gebraucht wird das, weil zwei gleichzeitige Kachelbauten einander
   * zerstoeren: beide planetiler-Prozesse benutzen DASSELBE Verzeichnis fuer
   * die gemeinsamen Basisdaten. Der zweite Lauf liest dann eine Datei, die
   * der erste noch herunterlaedt, und stirbt an
   * `java.util.zip.ZipException: zip END header not found` -- ein Fehler, der
   * wie ein kaputter Download aussieht und in Wahrheit ein Wettlauf ist.
   */
  findUnfinished(kind: string): JobSnapshot | undefined {
    for (const record of this.jobs.values()) {
      if (record.kind === kind && !isFinished(record)) {
        return toSnapshot(record);
      }
    }
    return undefined;
  }

  get(id: string): JobSnapshot | undefined {
    const record = this.jobs.get(id);
    return record ? toSnapshot(record) : undefined;
  }

  /** Registers a callback invoked once if/when the job is cancelled (used
   *  by the download runner to abort its in-flight HTTP request). */
  setOnCancel(id: string, onCancel: (() => void) | null): void {
    const record = this.jobs.get(id);
    if (record) {
      record.onCancel = onCancel;
    }
  }

  isCancelled(id: string): boolean {
    return this.jobs.get(id)?.cancelled ?? false;
  }

  /** Hinterlegt, wer den Stand eines Gesamtbaus ausrechnet. `null` entfernt
   *  ihn wieder. */
  setGesamtstand(id: string, gesamtstand: (() => Gesamtstand) | null): void {
    const record = this.jobs.get(id);
    if (record) {
      record.gesamtstand = gesamtstand;
    }
  }

  markRunning(id: string, totalBytes: number | null = null): void {
    const record = this.jobs.get(id);
    if (!record || isFinished(record)) {
      return;
    }
    record.status = 'running';
    if (totalBytes !== null) {
      record.totalBytes = totalBytes;
    }
    record.updatedAt = nowIso();
  }

  updateProgress(id: string, bytes: number, totalBytes?: number | null): void {
    const record = this.jobs.get(id);
    if (!record || isFinished(record)) {
      return;
    }
    record.bytes = bytes;
    if (totalBytes !== undefined && totalBytes !== null) {
      record.totalBytes = totalBytes;
    }
    record.progress = record.totalBytes ? Math.min(1, bytes / record.totalBytes) : 0;
    record.updatedAt = nowIso();
  }

  /** Setzt die Statuszeile eines laufenden Jobs (siehe `note`). Auf einem
   *  bereits beendeten Job ist das ein No-op -- eine Zeile, die nach dem
   *  Ende noch eintrudelt, darf den Endzustand nicht ueberschreiben. */
  setNote(id: string, note: string): void {
    const record = this.jobs.get(id);
    if (!record || isFinished(record)) {
      return;
    }
    record.note = note;
    record.updatedAt = nowIso();
  }

  markDone(id: string): void {
    const record = this.jobs.get(id);
    if (!record) {
      return;
    }
    record.status = 'done';
    record.progress = 1;
    record.error = null;
    record.updatedAt = nowIso();
  }

  markError(id: string, error: JobErrorInfo): void {
    const record = this.jobs.get(id);
    if (!record) {
      return;
    }
    record.status = 'error';
    record.error = error;
    record.updatedAt = nowIso();
  }

  /**
   * Requests cancellation of a queued/running job (fires its onCancel
   * callback, if any, so an in-flight download aborts promptly). Returns
   * false if the job doesn't exist or has already finished.
   */
  cancel(id: string): boolean {
    const record = this.jobs.get(id);
    if (!record || isFinished(record)) {
      return false;
    }
    record.cancelled = true;
    record.onCancel?.();
    return true;
  }
}
