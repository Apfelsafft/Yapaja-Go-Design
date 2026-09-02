/**
 * Tests für den Kachelbau-Job (B-04).
 *
 * Der planetiler-Lauf selbst kommt hier nicht vor — er dauert Stunden und
 * braucht Daten, die es in einer Testumgebung nicht gibt. Was geprüft wird,
 * ist alles DARUM HERUM, und das ist genau der Teil, in dem die Fehler
 * dieser Session steckten: welcher Befehl mit welchen Argumenten und welcher
 * Umgebung gestartet wird, was bei Erfolg, Fehlschlag und Abbruch im Job
 * landet, und dass eine Meldung nach Jobende den Endzustand nicht mehr
 * überschreibt.
 *
 * Der Prozess wird durch ein Stub ersetzt, das dieselbe schmale Schnittstelle
 * bedient wie `child_process.spawn` — dasselbe Muster, mit dem
 * `build-pmtiles.test.ts` `docker`/`java` ersetzt.
 */

import { describe, it, expect } from 'vitest';
import { Buffer } from 'node:buffer';
import {
  BUILD_COMMAND,
  BUILD_HEAP_BYTES,
  BUILD_RAM_OVERHEAD_BYTES,
  buildRequiredBytes,
  buildRequiredFreeMemory,
  lastMeaningfulLine,
  runBuildJob,
  truncateNote,
  type SpawnedBuild,
} from './build.js';
import { JobRegistry } from './jobs.js';
import type { CatalogEntry } from './catalog.js';

const ENTRY: CatalogEntry = {
  id: 'liechtenstein',
  name: 'Liechtenstein',
  pbfUrl: 'https://example.invalid/li-latest.osm.pbf',
  sizeBytes: 15_000_000,
  bounds: [9.47, 47.04, 9.63, 47.27],
};

/** Ein steuerbarer Ersatz für den gespawnten Prozess. */
function makeStub() {
  const handlers: Record<string, Array<(arg: never) => void>> = {};
  const outHandlers: Array<(chunk: Buffer | string) => void> = [];
  const errHandlers: Array<(chunk: Buffer | string) => void> = [];
  let killed: string | undefined;

  const child: SpawnedBuild = {
    stdout: { on: (_e, cb) => void outHandlers.push(cb) },
    stderr: { on: (_e, cb) => void errHandlers.push(cb) },
    on: (event: string, cb: (arg: never) => void) => {
      (handlers[event] ??= []).push(cb);
    },
    kill: (signal?: string) => {
      killed = signal;
      return true;
    },
  } as SpawnedBuild;

  return {
    child,
    emitStdout: (s: string) => outHandlers.forEach((cb) => cb(s)),
    emitStderr: (s: string) => errHandlers.forEach((cb) => cb(s)),
    close: (code: number | null) =>
      (handlers.close ?? []).forEach((cb) => (cb as (c: number | null) => void)(code)),
    fail: (err: Error) => (handlers.error ?? []).forEach((cb) => (cb as (e: Error) => void)(err)),
    killedWith: () => killed,
  };
}

describe('runBuildJob — Prozessstart', () => {
  it('startet den Wrapper mit Quelle, Regions-Id und den richtigen Umgebungsvariablen', () => {
    const jobs = new JobRegistry();
    const id = jobs.create();
    const stub = makeStub();
    const calls: Array<{ cmd: string; args: string[]; env: Record<string, string | undefined> }> = [];

    runBuildJob(id, jobs, ENTRY, '/share/yapaja/tiles', {
      spawnFn: (cmd, args, env) => {
        calls.push({ cmd, args, env });
        return stub.child;
      },
    });

    expect(calls).toHaveLength(1);
    expect(calls[0].cmd).toBe(BUILD_COMMAND);
    // Die Reihenfolge ist die des Wrappers: <pbf> [region-id].
    expect(calls[0].args).toEqual([ENTRY.pbfUrl, 'liechtenstein']);
    // TILES_DIR muss das Add-on-Verzeichnis sein, nicht der Repo-Default --
    // sonst landen die Kacheln dort, wo der Core sie nie sucht.
    expect(calls[0].env.TILES_DIR).toBe('/share/yapaja/tiles');
    expect(calls[0].env.PLANETILER_XMX).toBe('2g');
    expect(jobs.get(id)?.status).toBe('running');
  });

  it('lehnt einen Eintrag ohne pbfUrl ab, statt ins Leere zu starten', () => {
    const jobs = new JobRegistry();
    const id = jobs.create();
    let spawned = false;

    runBuildJob(id, jobs, { ...ENTRY, pbfUrl: undefined }, '/tiles', {
      spawnFn: () => {
        spawned = true;
        return makeStub().child;
      },
    });

    expect(spawned).toBe(false);
    expect(jobs.get(id)?.status).toBe('error');
    expect(jobs.get(id)?.error?.code).toBe('NO_BUILD_SOURCE');
  });

  // Fehlt der Wrapper im Image, meldet Node ENOENT über das `error`-Event.
  // Genau dieser Fall ist in dieser Session mehrfach aufgetreten (Skript
  // nicht im Image) -- die Meldung muss sagen, WAS erwartet wurde.
  it('meldet einen fehlenden Wrapper mit dem erwarteten Pfad', () => {
    const jobs = new JobRegistry();
    const id = jobs.create();
    const stub = makeStub();
    runBuildJob(id, jobs, ENTRY, '/tiles', { spawnFn: () => stub.child });

    stub.fail(new Error('spawn /usr/bin/yapaja-build-pmtiles ENOENT'));

    const job = jobs.get(id);
    expect(job?.status).toBe('error');
    expect(job?.error?.code).toBe('BUILD_START_FAILED');
    expect(job?.error?.message).toContain(BUILD_COMMAND);
  });
});

describe('runBuildJob — Verlauf und Ende', () => {
  it('führt die letzte Ausgabezeile als Statuszeile mit', () => {
    const jobs = new JobRegistry();
    const id = jobs.create();
    const stub = makeStub();
    runBuildJob(id, jobs, ENTRY, '/tiles', { spawnFn: () => stub.child });

    stub.emitStdout('lese Knoten…\nschreibe Kacheln 3/12\n');
    expect(jobs.get(id)?.note).toBe('schreibe Kacheln 3/12');

    // stderr zählt genauso: planetiler schreibt seinen Fortschritt dorthin.
    stub.emitStderr('fertig mit Phase 2');
    expect(jobs.get(id)?.note).toBe('fertig mit Phase 2');
  });

  /**
   * Beim ersten echten Fehlschlag stand im Panel nur „Code 1" -- und die
   * Meldung verwies auf „ausfuehrliche Ausgabe im Add-on-Protokoll", wo aber
   * nie etwas ankam: die Pipes des Kindprozesses wurden gelesen und
   * verworfen. Der einzige Text, der die Ursache genannt haette, ging
   * verloren. Ein Verweis auf ein leeres Protokoll ist dasselbe wie eine
   * Anweisung auf einen Knopf, den es nicht gibt.
   */
  it('spiegelt jede Ausgabezeile ins Protokoll, nicht nur die letzte', () => {
    const jobs = new JobRegistry();
    const id = jobs.create();
    const stub = makeStub();
    const logged: string[] = [];

    runBuildJob(id, jobs, ENTRY, '/tiles', {
      spawnFn: () => stub.child,
      logger: (line) => logged.push(line),
    });

    stub.emitStdout('erste Zeile\nzweite Zeile\n');
    stub.emitStderr('Fehler von planetiler');

    expect(logged.some((l) => l.includes('erste Zeile'))).toBe(true);
    expect(logged.some((l) => l.includes('zweite Zeile'))).toBe(true);
    expect(logged.some((l) => l.includes('Fehler von planetiler'))).toBe(true);
    // Praefix, damit die Zeilen im Add-on-Protokoll zwischen allem anderen
    // auffindbar sind -- die Fehlermeldung nennt genau dieses Praefix.
    expect(logged.every((l) => l.includes('[Kachelbau liechtenstein]'))).toBe(true);
  });

  /** Und die letzte Zeile gehoert IN die Fehlermeldung: die Oberflaeche
   *  zeigt im Fehlerfall die Meldung, nicht die Statuszeile. */
  it('nennt die letzte Ausgabezeile in der Fehlermeldung', () => {
    const jobs = new JobRegistry();
    const id = jobs.create();
    const stub = makeStub();
    runBuildJob(id, jobs, ENTRY, '/tiles', { spawnFn: () => stub.child });

    stub.emitStderr('java: command not found');
    stub.close(1);

    const message = jobs.get(id)?.error?.message ?? '';
    expect(message).toContain('java: command not found');
    expect(message).toContain('[Kachelbau liechtenstein]');
  });

  it('meldet Erfolg bei Code 0', () => {
    const jobs = new JobRegistry();
    const id = jobs.create();
    const stub = makeStub();
    runBuildJob(id, jobs, ENTRY, '/tiles', { spawnFn: () => stub.child });

    stub.close(0);
    expect(jobs.get(id)?.status).toBe('done');
    expect(jobs.get(id)?.error).toBeNull();
  });

  it('meldet einen Fehlschlag mit Code und dem Hinweis, dass die alte Datei unverändert ist', () => {
    const jobs = new JobRegistry();
    const id = jobs.create();
    const stub = makeStub();
    runBuildJob(id, jobs, ENTRY, '/tiles', { spawnFn: () => stub.child });

    stub.close(3);
    const job = jobs.get(id);
    expect(job?.status).toBe('error');
    expect(job?.error?.code).toBe('BUILD_FAILED');
    expect(job?.error?.message).toContain('3');
    // W-17: der atomare Swap ist die Zusage, die einen abgebrochenen Bau
    // harmlos macht. Sie gehört in die Meldung, sonst löscht der Betreiber
    // aus Sorge seine funktionierende Karte.
    expect(job?.error?.message).toContain('unverändert');
  });

  // Ein Abbruch, der den Prozess NICHT beendet, wäre eine Lüge: die Anzeige
  // sagt „abgebrochen", planetiler läuft stundenlang weiter.
  it('beendet den Prozess wirklich, wenn der Job abgebrochen wird', () => {
    const jobs = new JobRegistry();
    const id = jobs.create();
    const stub = makeStub();
    runBuildJob(id, jobs, ENTRY, '/tiles', { spawnFn: () => stub.child });

    jobs.cancel(id);
    expect(stub.killedWith()).toBe('SIGTERM');

    stub.close(143);
    const job = jobs.get(id);
    expect(job?.status).toBe('error');
    expect(job?.error?.code).toBe('CANCELLED');
  });

  it('eine Ausgabezeile nach Jobende überschreibt den Endzustand nicht', () => {
    const jobs = new JobRegistry();
    const id = jobs.create();
    const stub = makeStub();
    runBuildJob(id, jobs, ENTRY, '/tiles', { spawnFn: () => stub.child });

    stub.close(0);
    const noteAtEnd = jobs.get(id)?.note;
    stub.emitStdout('noch eine späte Zeile');

    expect(jobs.get(id)?.status).toBe('done');
    expect(jobs.get(id)?.note).toBe(noteAtEnd);
  });
});

describe('Vorprüf-Kennzahlen', () => {
  it('der Plattenbedarf berücksichtigt Arbeitsraum, nicht nur die fertige Datei', () => {
    // Der Bau legt ein Zwischenergebnis an; nur die Zielgröße zu verlangen
    // hieße, einen Lauf zuzulassen, der nach Stunden am vollen Datenträger
    // scheitert.
    expect(buildRequiredBytes(ENTRY)).toBeGreaterThan(ENTRY.sizeBytes);
  });

  it('der RAM-Bedarf ist Heap plus Overhead', () => {
    expect(buildRequiredFreeMemory()).toBe(BUILD_HEAP_BYTES + BUILD_RAM_OVERHEAD_BYTES);
  });
});

describe('Ausgabe-Aufbereitung', () => {
  it('nimmt die letzte nicht-leere Zeile, auch bei \\r-Fortschrittsbalken', () => {
    expect(lastMeaningfulLine('a\r\nb\r\n\r\n')).toBe('b');
    expect(lastMeaningfulLine('nur eine')).toBe('nur eine');
    expect(lastMeaningfulLine('   \n  \n')).toBeNull();
  });

  it('kürzt überlange Zeilen, statt das Panel zu sprengen', () => {
    const long = 'x'.repeat(500);
    const short = truncateNote(long);
    expect(short.length).toBeLessThanOrEqual(160);
    expect(short.endsWith('…')).toBe(true);
    expect(truncateNote('kurz')).toBe('kurz');
  });
});
