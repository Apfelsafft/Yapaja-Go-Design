/**
 * Der Knopf, der alles wieder zusammenbaut.
 *
 * ─── DIE LEITFRAGE ──────────────────────────────────────────────────────────
 * Kann dieser Lauf jemals „fertig" melden, obwohl etwas fehlt?
 *
 * Er baut das, wovon das Fahren abhängt. Ein „fertig", nach dem das Routing
 * fehlt, ist die teuerste Sorte Fehler, die dieses Projekt kennt — man merkt
 * es erst unterwegs.
 */

import { describe, it, expect, vi } from 'vitest';
import { JobRegistry } from './jobs.js';
import { gesamtplan, schrittText, starteGesamtbau } from './gesamtbau.js';
import { GRAPH_BUILD_COMMAND, LITE_INDEX_BUILD_COMMAND, type SpawnedBuild } from './build.js';
import type { CatalogEntry } from './catalog.js';
import { routingSchluessel, type Bauerfahrung } from './bauzeit.js';

/** Ein Kindprozess, den der Test von Hand enden lässt. */
function kind(): SpawnedBuild & { schliesse: (code: number | null) => void } {
  const handler: { close?: (c: number | null) => void; error?: (e: Error) => void } = {};
  return {
    stdout: { on: () => undefined },
    stderr: { on: () => undefined },
    on(event: string, cb: (arg: never) => void) {
      if (event === 'close') handler.close = cb as (c: number | null) => void;
      if (event === 'error') handler.error = cb as (e: Error) => void;
    },
    kill: () => true,
    schliesse: (code) => handler.close?.(code),
  } as SpawnedBuild & { schliesse: (code: number | null) => void };
}

function eintrag(id: string): CatalogEntry {
  return {
    id,
    name: id,
    sizeBytes: 1000,
    bounds: [0, 0, 1, 1],
    pbfUrl: `https://example.invalid/${id}.osm.pbf`,
  } as CatalogEntry;
}

interface Aufbau {
  jobs: JobRegistry;
  jobId: string;
  /** Die Kindprozesse in der Reihenfolge ihres Starts. */
  kinder: Array<ReturnType<typeof kind>>;
  /** Die Aufrufe: Kommando je Start. */
  kommandos: string[];
  gemerkt: Array<{ schluessel: string; sekunden: number }>;
  uhr: { vor: (ms: number) => void };
}

function baue(
  regionen: string[],
  opt: {
    erfahrung?: Bauerfahrung;
    /** Regionen, für die es KEINEN Katalogeintrag gibt. */
    ohneEintrag?: string[];
  } = {},
): Aufbau {
  let t = 1_000_000;
  const jobs = new JobRegistry();
  const jobId = jobs.create('heavy-build', { bauart: 'gesamt' });
  const kinder: Array<ReturnType<typeof kind>> = [];
  const kommandos: string[] = [];
  const gemerkt: Array<{ schluessel: string; sekunden: number }> = [];
  const ohne = new Set(opt.ohneEintrag ?? []);

  starteGesamtbau({
    jobId,
    jobs,
    regionen,
    eintragFuer: (region) => (ohne.has(region) ? undefined : eintrag(region)),
    tilesDir: '/data/tiles',
    bauzeitenPfad: '/data/bauzeiten.json',
    deps: {
      spawnFn: (command) => {
        kommandos.push(command);
        const k = kind();
        kinder.push(k);
        return k;
      },
    },
    jetzt: () => t,
    speicher: {
      lesen: () => opt.erfahrung ?? {},
      merken: (_pfad, schluessel, sekunden) => {
        gemerkt.push({ schluessel, sekunden });
      },
    },
  });

  return { jobs, jobId, kinder, kommandos, gemerkt, uhr: { vor: (ms) => (t += ms) } };
}

describe('der Plan', () => {
  it('Routing zuerst, dann die Suche je Karte', () => {
    // Das Routing zuerst, weil davon das FAHREN abhaengt: bricht der Lauf
    // danach ab, hat man eine fahrbare Installation ohne Adresssuche -- und
    // nicht umgekehrt.
    expect(gesamtplan(['germany', 'austria'])).toEqual([
      { bauart: 'routing', region: 'austria' },
      { bauart: 'suche', region: 'austria' },
      { bauart: 'suche', region: 'germany' },
    ]);
  });

  it('das Routing steht GENAU EINMAL darin, egal wie viele Karten', () => {
    // Es deckt seit 0.10.2 alle Karten ab. Einmal je Karte zu bauen, waere
    // dieselbe stundenlange Arbeit mehrfach.
    const plan = gesamtplan(['a', 'b', 'c', 'd']);
    expect(plan.filter((s) => s.bauart === 'routing')).toHaveLength(1);
    expect(plan).toHaveLength(5);
  });

  it('ohne Karte gibt es nichts zu bauen', () => {
    expect(gesamtplan([])).toEqual([]);
  });

  it('die Reihenfolge der Eingabe ändert den Plan nicht', () => {
    // Sonst haengt der Ablauf an der Sortierung des Dateisystems.
    expect(gesamtplan(['b', 'a'])).toEqual(gesamtplan(['a', 'b']));
  });
});

describe('die Beschriftung eines Schritts', () => {
  it('nennt bei einer Karte deren Namen', () => {
    expect(schrittText({ bauart: 'routing', region: 'germany' }, ['germany'])).toBe(
      'Routing bauen (germany)',
    );
  });

  it('nennt bei mehreren die ANZAHL, nicht eine davon', () => {
    // „Routing bauen (austria)" waere bei drei Karten schlicht falsch -- es
    // wird ueber alle gebaut.
    expect(schrittText({ bauart: 'routing', region: 'austria' }, ['austria', 'germany'])).toBe(
      'Routing bauen (2 Karten)',
    );
  });

  it('die Suche nennt immer ihre Region', () => {
    expect(schrittText({ bauart: 'suche', region: 'germany' }, ['a', 'germany'])).toBe(
      'Suche bauen (germany)',
    );
  });
});

describe('der Ablauf', () => {
  it('startet mit dem Routinggraphen', () => {
    const a = baue(['germany']);
    expect(a.kommandos).toEqual([GRAPH_BUILD_COMMAND]);
  });

  it('geht nach Erfolg zum nächsten Schritt über — ohne den Job zu beenden', () => {
    // ─── DER KERN DES UMBAUS ────────────────────────────────────────────────
    // Vor 0.16.0 beendete ein fertiger Lauf immer den Job. Ein Gesamtbau
    // braucht das Gegenteil.
    const a = baue(['germany']);
    a.kinder[0].schliesse(0);
    expect(a.jobs.get(a.jobId)?.status).toBe('running');
    expect(a.kommandos).toEqual([GRAPH_BUILD_COMMAND, LITE_INDEX_BUILD_COMMAND]);
  });

  it('erst nach dem LETZTEN Schritt ist der Job fertig', () => {
    const a = baue(['germany']);
    a.kinder[0].schliesse(0);
    a.kinder[1].schliesse(0);
    expect(a.jobs.get(a.jobId)?.status).toBe('done');
  });

  it('baut die Suche für JEDE Karte', () => {
    const a = baue(['austria', 'germany']);
    a.kinder[0].schliesse(0);
    a.kinder[1].schliesse(0);
    a.kinder[2].schliesse(0);
    expect(a.kommandos).toEqual([
      GRAPH_BUILD_COMMAND,
      LITE_INDEX_BUILD_COMMAND,
      LITE_INDEX_BUILD_COMMAND,
    ]);
    expect(a.jobs.get(a.jobId)?.status).toBe('done');
  });
});

describe('wenn ein Schritt scheitert', () => {
  it('der Lauf endet — er macht NICHT weiter', () => {
    // ─── DIE LEITFRAGE DIESER DATEI ─────────────────────────────────────────
    // Weiterzumachen hiesse, am Ende „fertig" zu melden, obwohl das Routing
    // fehlt. Man merkt es dann erst unterwegs.
    const a = baue(['germany']);
    a.kinder[0].schliesse(1);
    expect(a.jobs.get(a.jobId)?.status).toBe('error');
    expect(a.kommandos, 'der zweite Schritt lief trotzdem an').toHaveLength(1);
  });

  it('die Fehlermeldung sagt, WELCHER Schritt es war', () => {
    // Bei fünf Schritten ist „Bau fehlgeschlagen" keine Auskunft.
    const a = baue(['austria', 'germany']);
    a.kinder[0].schliesse(0);
    a.kinder[1].schliesse(1);
    const meldung = a.jobs.get(a.jobId)?.error?.message ?? '';
    expect(meldung).toContain('Schritt 2 von 3');
    expect(meldung).toContain('Suche bauen (austria)');
  });

  it('eine gescheiterte Dauer wird NICHT als Erfahrung gemerkt', () => {
    // Sonst staende beim naechsten Mal die Dauer bis zum Absturz als
    // Erwartung da.
    const a = baue(['germany']);
    a.uhr.vor(60_000);
    a.kinder[0].schliesse(1);
    expect(a.gemerkt).toEqual([]);
  });

  it('ein Abbruch beendet den Lauf mit der gewohnten Meldung', () => {
    const a = baue(['germany']);
    a.jobs.cancel(a.jobId);
    const job = a.jobs.get(a.jobId);
    expect(job?.status).toBe('error');
    expect(job?.error?.code).toBe('CANCELLED');
    expect(a.kommandos).toHaveLength(1);
  });
});

describe('eine von Hand abgelegte Karte', () => {
  it('wird übersprungen, statt den ganzen Lauf zu stoppen', () => {
    // Eine installierte `.pmtiles` ohne Katalogeintrag hat keine OSM-Quelle.
    // Fuer sie laesst sich nichts bauen -- fuer die ANDEREN sehr wohl, und
    // ein Lauf, der an der ersten Handablage stirbt, waere fuer die wertlos.
    const a = baue(['fremd', 'germany'], { ohneEintrag: ['fremd'] });
    // Schritt 1 ist das Routing unter `fremd` -> uebersprungen.
    // Schritt 2 ist die Suche fuer `fremd` -> uebersprungen.
    // Schritt 3 ist die Suche fuer `germany` -> laeuft.
    expect(a.kommandos).toEqual([LITE_INDEX_BUILD_COMMAND]);
    a.kinder[0].schliesse(0);
    expect(a.jobs.get(a.jobId)?.status).toBe('done');
  });

  it('sagt in der Statuszeile, dass übersprungen wurde', () => {
    // Stumm zu ueberspringen waere genau die Fehlerklasse, die dieses Projekt
    // seit Monaten verfolgt.
    const a = baue(['fremd', 'germany'], { ohneEintrag: ['fremd'] });
    a.kinder[0].schliesse(0);
    // Die Notiz des letzten Ueberspringens steht noch, bis der Schritt
    // danach seine eigene setzt -- geprueft wird hier, dass es sie gibt.
    expect(a.jobs.get(a.jobId)?.note).toBeTruthy();
  });
});

describe('ohne installierte Karte', () => {
  it('wird gar nicht erst gestartet', () => {
    // Ein Lauf, der nach zwei Sekunden „fertig" meldet und nichts getan hat,
    // ist schlimmer als eine Absage.
    const a = baue([]);
    expect(a.kommandos).toEqual([]);
    const job = a.jobs.get(a.jobId);
    expect(job?.status).toBe('error');
    expect(job?.error?.code).toBe('NO_REGIONS');
  });
});

describe('der Stand, den die Oberfläche abfragt', () => {
  const ERFAHRUNG = {
    [routingSchluessel(['germany'])]: 1800,
    'suche:germany': 600,
  };

  it('nennt Schritt und Gesamtzahl, 1-basiert', () => {
    const a = baue(['germany'], { erfahrung: ERFAHRUNG });
    const g = a.jobs.get(a.jobId)?.gesamt;
    expect(g?.schritt).toBe(1);
    expect(g?.schritte).toBe(2);
    expect(g?.schrittText).toBe('Routing bauen (germany)');
  });

  it('zählt beim Schrittwechsel weiter', () => {
    const a = baue(['germany'], { erfahrung: ERFAHRUNG });
    a.kinder[0].schliesse(0);
    const g = a.jobs.get(a.jobId)?.gesamt;
    expect(g?.schritt).toBe(2);
    expect(g?.schrittText).toBe('Suche bauen (germany)');
  });

  it('die Restzeit SINKT, während derselbe Schritt läuft', () => {
    // ─── DIE EIGENTLICHE FORDERUNG ──────────────────────────────────────────
    // „Sollte sich entsprechend des Bau-Fortschritts aktualisieren." Ohne
    // diese Pruefung waere eine Restzeit, die nur bei Schrittwechseln neu
    // entsteht, nicht von einer richtigen zu unterscheiden.
    const a = baue(['germany'], { erfahrung: ERFAHRUNG });
    const vorher = a.jobs.get(a.jobId)?.gesamt?.restSekunden;
    a.uhr.vor(600_000);
    const nachher = a.jobs.get(a.jobId)?.gesamt?.restSekunden;
    expect(vorher).toBe(2400);
    expect(nachher).toBe(1800);
  });

  it('ohne Erfahrung gibt es keine Zahl und keinen Satz', () => {
    const a = baue(['germany']);
    const g = a.jobs.get(a.jobId)?.gesamt;
    expect(g?.restSekunden).toBeNull();
    expect(g?.restGrund).toBe('unbekannt');
    expect(g?.restText).toBeNull();
  });

  it('mit Erfahrung steht ein lesbarer Satz da', () => {
    const a = baue(['germany'], { erfahrung: ERFAHRUNG });
    expect(a.jobs.get(a.jobId)?.gesamt?.restText).toBe('noch etwa 40 Min.');
  });

  it('ein Job ohne Gesamtbau trägt das Feld gar nicht', () => {
    // Sonst saehe jeder Einzelbau nach einem Ablauf mit einem Schritt aus.
    const jobs = new JobRegistry();
    const id = jobs.create('heavy-build', { bauart: 'routing' });
    expect(jobs.get(id)?.gesamt).toBeUndefined();
  });
});

describe('die gemessenen Dauern', () => {
  it('jeder geglückte Schritt wird gemerkt', () => {
    const a = baue(['germany']);
    a.uhr.vor(1800_000);
    a.kinder[0].schliesse(0);
    a.uhr.vor(600_000);
    a.kinder[1].schliesse(0);
    expect(a.gemerkt).toEqual([
      { schluessel: routingSchluessel(['germany']), sekunden: 1800 },
      { schluessel: 'suche:germany', sekunden: 600 },
    ]);
  });

  it('das Routing wird unter ALLEN Regionen gemerkt, nicht unter einer', () => {
    // Seine Dauer haengt an der Menge der Karten. Unter einer einzelnen
    // Region gemerkt, bekaeme ein Bau ueber drei Laender die Dauer von einem.
    const a = baue(['austria', 'germany']);
    a.uhr.vor(3600_000);
    a.kinder[0].schliesse(0);
    expect(a.gemerkt[0].schluessel).toBe(routingSchluessel(['austria', 'germany']));
  });

  it('die Erfahrung wird EINMAL zu Beginn gelesen, nicht je Schritt', () => {
    // Die Messungen DIESES Laufs als Erfahrung fuer denselben Lauf zu
    // verwenden, waere zirkulaer.
    const lesen = vi.fn(() => ({}));
    const jobs = new JobRegistry();
    const jobId = jobs.create('heavy-build', {});
    const kinder: Array<ReturnType<typeof kind>> = [];
    starteGesamtbau({
      jobId,
      jobs,
      regionen: ['germany'],
      eintragFuer: (r) => eintrag(r),
      tilesDir: '/data/tiles',
      bauzeitenPfad: '/data/bauzeiten.json',
      deps: {
        spawnFn: () => {
          const k = kind();
          kinder.push(k);
          return k;
        },
      },
      jetzt: () => 1_000_000,
      speicher: { lesen, merken: () => undefined },
    });
    kinder[0].schliesse(0);
    kinder[1].schliesse(0);
    expect(lesen).toHaveBeenCalledTimes(1);
  });
});
