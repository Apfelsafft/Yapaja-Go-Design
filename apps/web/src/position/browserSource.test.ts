/**
 * Tests für `browserSource` (E02-T2).
 *
 * ─── WARUM DIESE DATEI NEU GESCHRIEBEN WURDE ────────────────────────────────
 * Bis 2026-09-02 stand hier ausschliesslich, dass die exportierten Typ-Unions
 * existieren:
 *
 *     const errorTypes: Array<'insecure-context' | …> = ['insecure-context', …];
 *     expect(errorTypes.length).toBe(3);
 *
 * Das ist keine Zusicherung ueber das Verhalten des Moduls, sondern ueber die
 * Zeile darueber -- ein Test, der nicht fehlschlagen kann. Genau darunter
 * konnte sich der Fehler verstecken, den `checkActiveSource()` ausfuehrlich
 * beschreibt: der Client las `s.id`, der Core liefert `s.name`, und deshalb
 * hoerte der Browser 5 Sekunden nach dem ersten Fix auf zu senden. Die
 * einzige E2E-Zusicherung dazu (`position.spec.ts`) stand in einem
 * `if (sentPositions.length > 0)` und schwieg damit ausgerechnet im
 * Fehlerfall.
 *
 * Die Tests hier fahren deshalb den ECHTEN Weg: `watchPosition` liefert einen
 * Fix, und geprueft wird, ob `POST /api/v1/position/browser` tatsaechlich
 * abgeht. Die Antwort auf `GET /position/sources` ist wortwoertlich die, die
 * `PositionService.getSources()` erzeugt (`{name, active, lastFixTs}` plus
 * `active`/`forced`) -- ein Test gegen eine ausgedachte Form haette den
 * Fehler wieder nicht gefunden.
 *
 * Das Modul exportiert nur die Singleton-Instanz. Damit jeder Testfall mit
 * frischem Zustand laeuft, wird es pro Fall ueber `vi.resetModules()` neu
 * importiert.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

interface SourcesBody {
  sources: Array<{ name: string; active: boolean; lastFixTs: string | null }>;
  active: string | null;
  forced: string | null;
}

/** Antwort von `GET /position/sources` in exakt der Form, die der Core sendet. */
function sourcesBody(overrides: Partial<SourcesBody> = {}): SourcesBody {
  return {
    sources: [
      { name: 'gpsd', active: false, lastFixTs: null },
      { name: 'browser', active: false, lastFixTs: null },
      { name: 'simulator', active: false, lastFixTs: null },
    ],
    active: null,
    forced: null,
    ...overrides,
  };
}

interface Harness {
  /** Ruft den `watchPosition`-Erfolgs-Callback mit einem gültigen Fix auf. */
  emitFix: () => void;
  /** URLs, an die der Client tatsächlich POSTet. */
  posted: string[];
  /** Simuliert einen Fehler des `watchPosition`-Callbacks. */
  emitError: (code: number) => void;
  /** Ändert die Antwort auf `GET /position/sources` für die nächsten Abrufe. */
  setSources: (next: SourcesBody) => void;
  /** Führt den 5-Sekunden-Poll von Hand aus (der Timer selbst ist gestubbt). */
  poll: () => Promise<void>;
}

let harness: Harness;

function install(options: { secureContext?: boolean; sources?: SourcesBody } = {}): void {
  const { secureContext = true, sources = sourcesBody() } = options;
  let current = sources;
  const posted: string[] = [];
  let onSuccess: ((p: unknown) => void) | null = null;
  let onError: ((e: unknown) => void) | null = null;
  let tick: (() => void) | null = null;

  const define = (key: string, value: unknown): void => {
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
  };

  define('window', {
    isSecureContext: secureContext,
    // Der Timer läuft im Test nicht von allein: `startSourceCheck()` ruft
    // `checkActiveSource()` ohnehin sofort einmal auf, und für den Fall, dass
    // ein Test einen ZWEITEN Abruf braucht, wird der Rückruf hier festgehalten
    // und über `harness.poll()` gezielt ausgelöst -- deterministisch statt
    // 5 Sekunden Wartezeit.
    setInterval: (cb: () => void) => {
      tick = cb;
      return 1;
    },
    clearInterval: () => undefined,
  });
  define('navigator', {
    geolocation: {
      watchPosition: (success: (p: unknown) => void, error: (e: unknown) => void) => {
        onSuccess = success;
        onError = error;
        return 7;
      },
      clearWatch: () => undefined,
    },
  });
  define(
    'fetch',
    vi.fn(async (url: string, init?: { method?: string }) => {
      if (String(url).includes('position/sources')) {
        return { ok: true, status: 200, json: async () => current };
      }
      posted.push(`${init?.method ?? 'GET'} ${String(url)}`);
      return { ok: true, status: 200, json: async () => ({}) };
    }),
  );

  harness = {
    posted,
    emitFix: () =>
      onSuccess?.({
        coords: {
          latitude: 47.141,
          longitude: 9.521,
          altitude: 460,
          accuracy: 8,
          speed: 12,
          heading: 90,
        },
        timestamp: Date.now(),
      }),
    emitError: (code: number) => onError?.({ code }),
    setSources: (next: SourcesBody) => {
      current = next;
    },
    poll: async () => {
      tick?.();
      await new Promise((r) => setTimeout(r, 10));
    },
  };
}

/** Frischer Modulzustand pro Fall, dann `start()` und einmal durchatmen,
 *  damit der sofortige `/position/sources`-Abruf beantwortet ist. */
async function startFresh(): Promise<typeof import('./browserSource')> {
  vi.resetModules();
  const mod = await import('./browserSource');
  await mod.browserSource.start();
  await new Promise((r) => setTimeout(r, 10));
  return mod;
}

/** Wartet, bis die Sende-Warteschlange abgearbeitet sein kann (100 ms Pause
 *  zwischen zwei Sendungen sind im Modul fest verdrahtet). */
function settle(): Promise<void> {
  return new Promise((r) => setTimeout(r, 250));
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('browserSource: Senden an den Core', () => {
  beforeEach(() => {
    install();
  });

  it('sendet einen Fix, während noch keine Quelle aktiv ist (Kaltstart)', async () => {
    await startFresh();
    harness.emitFix();
    await settle();
    expect(harness.posted.filter((p) => p.includes('position/browser'))).toHaveLength(1);
  });

  it('sendet WEITER, nachdem der Core "browser" als aktive Quelle meldet', async () => {
    // DAS ist der Regressionsfall. Genau hier verstummte der Client: sobald
    // der eigene Fix die Quelle `browser` aktiv gemacht hatte, schaltete er
    // sich selbst ab -- und liess die Oberflaeche im 5-Sekunden-Takt
    // „GPS-Signal verloren" zeigen.
    install({
      sources: sourcesBody({
        sources: [
          { name: 'gpsd', active: false, lastFixTs: null },
          { name: 'browser', active: true, lastFixTs: new Date().toISOString() },
          { name: 'simulator', active: false, lastFixTs: null },
        ],
        active: 'browser',
      }),
    });
    await startFresh();
    harness.emitFix();
    await settle();
    expect(harness.posted.filter((p) => p.includes('position/browser'))).toHaveLength(1);
  });

  it('sendet, wenn "browser" ausdrücklich erzwungen ist', async () => {
    install({ sources: sourcesBody({ forced: 'browser' }) });
    await startFresh();
    harness.emitFix();
    await settle();
    expect(harness.posted.filter((p) => p.includes('position/browser'))).toHaveLength(1);
  });

  it('sendet NICHT, wenn eine andere Quelle erzwungen ist', async () => {
    install({ sources: sourcesBody({ forced: 'gpsd', active: 'gpsd' }) });
    await startFresh();
    harness.emitFix();
    await settle();
    expect(harness.posted.filter((p) => p.includes('position/browser'))).toEqual([]);
  });

  it('sendet als POST an /api/v1/position/browser', async () => {
    await startFresh();
    harness.emitFix();
    await settle();
    expect(harness.posted).toContain('POST /api/v1/position/browser');
  });
});

describe('browserSource: Warteschlange hält nur den neuesten Fix', () => {
  it('liefert einen Rückstau NICHT am Stück nach', async () => {
    // Positionsmeldungen sind verderblich. Die Warteschlange war unbegrenzt:
    // konnte der Client eine Weile nicht senden, staute sie sich auf und ging
    // danach im 100-ms-Takt am Stück raus -- der Core verarbeitete längst
    // gefahrene Positionen der Reihe nach als aktuell.
    //
    // Das war nebenbei der Grund, warum die erste Fassung der E2E-Zusicherung
    // den Fehler NICHT fand: sie zählte POSTs, und der Nachschub-Schwall kam
    // auf dieselbe Zahl wie ein durchgehend laufendes Signal.
    install({ sources: sourcesBody({ forced: 'gpsd', active: 'gpsd' }) });
    await startFresh();

    // Gesperrt: vier Fixes laufen auf, gesendet wird nichts.
    harness.emitFix();
    harness.emitFix();
    harness.emitFix();
    harness.emitFix();
    await settle();
    expect(harness.posted.filter((p) => p.includes('position/browser'))).toEqual([]);

    // Sperre fällt weg. Nachgeliefert wird GENAU EINER -- der neueste --,
    // nicht die vier aufgestauten.
    harness.setSources(sourcesBody());
    await harness.poll();
    await settle();
    expect(harness.posted.filter((p) => p.includes('position/browser'))).toHaveLength(1);
  });
});

describe('browserSource: Vorbedingungen und Fehlerzustände', () => {
  it('startet gar nicht ohne sicheren Kontext (W-03) und sendet nichts', async () => {
    // Der Fall des Betreibers: Home Assistant über http://…:8123 aufgerufen.
    // Kein sicherer Kontext -> der Browser gibt den Sensor nicht frei.
    install({ secureContext: false });
    const { browserSource } = await startFresh();
    expect(browserSource.getState().status).toBe('error');
    expect(browserSource.getState().error).toBe('insecure-context');
    expect(harness.posted.filter((p) => p.includes('position/browser'))).toEqual([]);
  });

  it('meldet eine verweigerte Berechtigung als permission-denied', async () => {
    install();
    const { browserSource } = await startFresh();
    harness.emitError(1);
    expect(browserSource.getState().error).toBe('permission-denied');
  });

  it('meldet ein Zeitlimit als timeout und sendet danach nichts', async () => {
    install();
    const { browserSource } = await startFresh();
    harness.emitError(3);
    expect(browserSource.getState().error).toBe('timeout');
    await settle();
    expect(harness.posted.filter((p) => p.includes('position/browser'))).toEqual([]);
  });

  it('kommt nach einem Zeitlimit mit dem nächsten Fix von allein zurück', async () => {
    // Es gibt bewusst keinen eigenen Backoff (siehe Modul-Kopf): `watchPosition`
    // laeuft weiter, und der naechste Erfolg setzt den Zustand selbst zurueck.
    install();
    const { browserSource } = await startFresh();
    harness.emitError(3);
    harness.emitFix();
    await settle();
    expect(browserSource.getState().status).toBe('active');
    expect(harness.posted.filter((p) => p.includes('position/browser'))).toHaveLength(1);
  });
});

describe('browserSource: Abbildung des Browser-Fixes auf Position', () => {
  it('übernimmt Geschwindigkeit, Kurs und Genauigkeit und markiert die Quelle', async () => {
    install();
    const { browserSource } = await startFresh();
    harness.emitFix();
    await settle();
    const last = browserSource.getState().lastPosition;
    expect(last).toBeDefined();
    expect(last?.source).toBe('browser');
    expect(last?.speed).toBe(12);
    expect(last?.heading).toBe(90);
    expect(last?.accuracy).toBe(8);
    // Genauigkeit < 100 m und eine Höhe vorhanden -> 3d.
    expect(last?.fix).toBe('3d');
  });
});
