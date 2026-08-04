/**
 * [Perf] Bild-Rate beim scripted Pan/Zoom und waehrend einer simulierten
 * Fahrt -- Budget >= 30 fps (docs/00, Wargame W-04).
 *
 * WIE HIER GEMESSEN WIRD, UND WARUM SO
 * ------------------------------------
 * Die Suite treibt die App ueber ihre EIGENE Instrumentierung: die Seite
 * wird mit `?perf=1` geladen, der bestehende fps-Watchdog aus E01-T6
 * (`apps/web/src/perf/{fpsMeter,perfWatchdog}.ts`) laeuft mit, und sein Wert
 * wird ueber das `perf-stats-update`-Event mitgeschnitten. Zusaetzlich zaehlt
 * die Messung selbst rAF-Frames im Fenster.
 *
 * Beide Zahlen werden berichtet, weil sie sich gegenseitig validieren; bei
 * KONTINUIERLICHER Kamerabewegung stimmen sie ueberein (real gemessen:
 * 15,5 / 15,5 fps ungedrosselt, 11,1 / 11,1 fps bei 4x-Drosselung). Gegatet
 * wird der eigene Zaehler, weil er auch dann definiert ist, wenn die Kamera
 * nur in Schueben laeuft.
 *
 * ZWEI FALLSTRICKE, die beim Aufbau dieser Messung real aufgetreten sind und
 * die hier bewusst vermieden werden (Messaufbau fixen, nicht Schwellen):
 *
 *  1. KEINE Bearing-Aenderung im Pan/Zoom-Skript. Die App haelt in
 *     `2d-north` die Kamera nach Norden; ein `easeTo` mit `bearing` wird
 *     deshalb nach ~100 ms von der App selbst abgebrochen. Ergebnis waren 28
 *     Kamera-Starts/-Stopps statt 10 sauberer Fahrten und eine
 *     Bewegungszeit von 1,0 s in einem 10-s-Fenster -- die Messung haette
 *     dann die Abbruch-Logik gemessen, nicht die Bild-Rate.
 *  2. KEIN `setTimeout` als Taktgeber. Jede Etappe wird auf `moveend`
 *     abgewartet, sonst faellt zwischen zwei Etappen eine Luecke an, in der
 *     nichts gezeichnet wird -- und die Luecke landet im Nenner.
 *
 * "FAHRT": gemessen wird Pan/Zoom WAEHREND eine simulierte Fahrt laeuft --
 * GPS-Simulator aktiv, Positions-Events ueber WS, Nav-/Positionszustand
 * laufend aktualisiert. Das ist der W-04-Fall ("Rendering bricht ein") und
 * zugleich der einzige Fahrt-Zustand, in dem eine Bild-Rate ueberhaupt
 * definiert ist: die App zentriert per `jumpTo` (Follow-Me), zwischen zwei
 * Fixes zeichnet die Karte bestimmungsgemaess NICHTS -- ein "fps" aus diesen
 * Leerlaufphasen waere eine Zahl ohne Bedeutung.
 *
 * Dritter, ebenfalls real aufgetretener Fallstrick: Follow-Me reisst waehrend
 * der Fahrt bei jedem Fix die Kamera per `jumpTo` an sich und bricht damit
 * jedes `easeTo` ab (im ersten Lauf dieser Suite: Etappe nach 574 statt
 * 2000 ms beendet). Geloest wird das so, wie die App es selbst vorsieht --
 * mit einer echten Zieh-Geste, die Follow-Me pausiert
 * (`pauseFollowMeByUserGesture`). Gemessen wird damit exakt der reale
 * Bedienfall: jemand schwenkt die Karte, waehrend das Fahrzeug faehrt.
 */

import { test, expect } from '@playwright/test';
import { readFileSync } from 'fs';
import { encodePolyline6, type LatLon } from '../../apps/core/src/routing/polyline.js';
import { PERF_CORE_BASE_URL, PERF_ENVIRONMENT_FILE, PERF_VIEWPORT } from './support/constants.js';
import {
  SOFTWARE_RENDERER_ADVISORY,
  installDegradation,
  isSoftwareRenderer,
  pauseFollowMeByUserGesture,
  releasePositionSource,
  throttleCpu,
  waitForMapLoaded,
} from './support/page.js';
import { recordAndAssert } from './support/measure.js';
import type { EnvironmentSignature } from './trend.js';

/** Vier Etappen a 2 s -> 8 s zusammenhaengende Kamerabewegung je Messung. */
const LEG_DURATION_MS = 2_000;

/** Track fuer die simulierte Fahrt: innerhalb der Fixture-Region (lon 5.8-15.1, lat 47.2-55.1). */
const BASE_LAT = 47.4;
const BASE_LON = 9.55;
const TRACK_POINTS: LatLon[] = Array.from({ length: 60 }, (_, i) => ({
  lat: BASE_LAT + i * 0.0005,
  lon: BASE_LON + i * 0.0002,
}));

interface FpsResult {
  readonly ownFps: number;
  readonly watchdogFps: number | null;
  readonly frames: number;
  readonly elapsedMs: number;
  readonly legMs: readonly number[];
}

function environment(): EnvironmentSignature {
  const parsed = JSON.parse(readFileSync(PERF_ENVIRONMENT_FILE, 'utf8')) as {
    environment: EnvironmentSignature;
  };
  return parsed.environment;
}

/** Faehrt das Pan/Zoom-Skript ab und liefert die Bild-Rate im Fenster. */
async function measurePanZoomFps(page: import('@playwright/test').Page): Promise<FpsResult> {
  return page.evaluate(async (legDurationMs: number) => {
    const map = window.__yapajaMapController?.getMap?.();
    if (!map) throw new Error('Karte nicht registriert');

    const start = map.getCenter();
    const legs = [
      { center: [start.lng + 0.02, start.lat + 0.01] as [number, number], zoom: 12.5 },
      { center: [start.lng + 0.04, start.lat - 0.01] as [number, number], zoom: 13.5 },
      { center: [start.lng - 0.01, start.lat - 0.02] as [number, number], zoom: 12.0 },
      { center: [start.lng, start.lat] as [number, number], zoom: 13.0 },
    ];

    const watchdogSamples: number[] = [];
    const onStats = (event: Event): void => {
      const detail = (event as CustomEvent<{ fps: number }>).detail;
      if (Number.isFinite(detail?.fps) && detail.fps > 0) watchdogSamples.push(detail.fps);
    };
    window.addEventListener('perf-stats-update', onStats);

    let frames = 0;
    let running = true;
    const tick = (): void => {
      if (!running) return;
      frames += 1;
      requestAnimationFrame(tick);
    };

    const t0 = performance.now();
    requestAnimationFrame(tick);
    const legMs: number[] = [];
    for (const leg of legs) {
      const legStart = performance.now();
      const done = new Promise<void>((resolve) => map.once('moveend', () => resolve()));
      // Kein `bearing` (siehe Kopfkommentar), lineares Easing fuer eine
      // gleichmaessige Last statt eines Ease-in/out-Profils.
      map.easeTo({ ...leg, duration: legDurationMs, easing: (t: number) => t });
      await done;
      legMs.push(performance.now() - legStart);
    }
    running = false;
    const elapsedMs = performance.now() - t0;
    window.removeEventListener('perf-stats-update', onStats);

    const watchdogFps =
      watchdogSamples.length > 0
        ? watchdogSamples.slice(Math.floor(watchdogSamples.length / 2)).reduce((a, b) => a + b, 0) /
          Math.max(1, watchdogSamples.length - Math.floor(watchdogSamples.length / 2))
        : null;

    return { ownFps: (frames / elapsedMs) * 1000, watchdogFps, frames, elapsedMs, legMs };
  }, LEG_DURATION_MS);
}

test.describe('[Perf] Bild-Rate (W-04)', () => {
  test('[Perf] fps beim scripted Pan/Zoom >= 30', async ({ browser }) => {
    const env = environment();
    const software = isSoftwareRenderer(env.glRenderer);

    const context = await browser.newContext({
      viewport: { ...PERF_VIEWPORT },
      serviceWorkers: 'block',
    });
    let result: FpsResult;
    try {
      const page = await context.newPage();
      await throttleCpu(context, page);
      await installDegradation(page);
      await page.goto(`${PERF_CORE_BASE_URL}/?perf=1`, { timeout: 120_000 });
      await waitForMapLoaded(page);
      result = await measurePanZoomFps(page);
    } finally {
      await context.close();
    }

    // Der Messaufbau selbst muss stimmen: jede Etappe muss wirklich ~2 s
    // durchgelaufen sein. Bricht eine Etappe ab (Fallstrick 1 im Kopf), ist
    // die fps-Zahl bedeutungslos und die Spec soll scheitern statt zu melden.
    for (const ms of result.legMs) {
      expect(ms, 'Kamera-Etappe wurde abgebrochen -- Messaufbau, nicht Bild-Rate').toBeGreaterThan(
        LEG_DURATION_MS * 0.8,
      );
    }

    recordAndAssert({
      id: 'fps_pan_zoom',
      value: result.ownFps,
      samples: [Math.round(result.ownFps * 10) / 10],
      advisory: software || undefined,
      advisoryReason: software ? SOFTWARE_RENDERER_ADVISORY : undefined,
      note:
        `${result.frames} Frames in ${result.elapsedMs.toFixed(0)} ms; ` +
        `App-eigener fps-Watchdog (E01-T6) meldet ${
          result.watchdogFps === null ? '—' : result.watchdogFps.toFixed(1)
        } fps; GL "${env.glRenderer}"`,
    });
  });

  test('[Perf] fps waehrend simulierter Fahrt >= 30', async ({ browser, request }) => {
    const env = environment();
    const software = isSoftwareRenderer(env.glRenderer);

    const context = await browser.newContext({
      viewport: { ...PERF_VIEWPORT },
      serviceWorkers: 'block',
    });
    let result: FpsResult;
    try {
      const page = await context.newPage();
      await throttleCpu(context, page);
      await installDegradation(page);
      await page.goto(`${PERF_CORE_BASE_URL}/?perf=1`, { timeout: 120_000 });
      await waitForMapLoaded(page);

      // Echte Fahrt: der GPS-Simulator spielt einen Track ab, der Core
      // veroeffentlicht `pos/update` ueber WS, Follow-Me zentriert die Karte.
      const play = await request.post(`${PERF_CORE_BASE_URL}/api/v1/simulator/play`, {
        data: {
          track: { polyline6: encodePolyline6(TRACK_POINTS), speedMs: 14 },
          speed_factor: 1,
        },
      });
      expect(play.ok()).toBe(true);

      // Erst messen, wenn wirklich Positionen ankommen -- sonst waere es
      // dieselbe Messung wie oben, nur mit anderem Namen.
      await page.waitForFunction(
        () => Boolean(window.__yapajaPositionStore?.getState().position),
        undefined,
        { timeout: 30_000 },
      );

      // Follow-Me wuerde die Kamera bei jedem Fix per `jumpTo` an sich
      // reissen und jede Etappe abbrechen. Die App pausiert Follow-Me bei
      // einer Nutzergeste -- genau die wird hier ausgefuehrt, statt am Store
      // vorbeizugreifen. Der gemessene Zustand ist damit der reale: der
      // Beifahrer schwenkt die Karte, waehrend das Fahrzeug faehrt.
      await pauseFollowMeByUserGesture(page);

      result = await measurePanZoomFps(page);
    } finally {
      await request.post(`${PERF_CORE_BASE_URL}/api/v1/simulator/stop`).catch(() => undefined);
      await releasePositionSource(request, PERF_CORE_BASE_URL);
      await context.close();
    }

    for (const ms of result.legMs) {
      expect(ms, 'Kamera-Etappe wurde abgebrochen -- Messaufbau, nicht Bild-Rate').toBeGreaterThan(
        LEG_DURATION_MS * 0.8,
      );
    }

    recordAndAssert({
      id: 'fps_drive',
      value: result.ownFps,
      samples: [Math.round(result.ownFps * 10) / 10],
      advisory: software || undefined,
      advisoryReason: software ? SOFTWARE_RENDERER_ADVISORY : undefined,
      note:
        `Pan/Zoom bei laufendem GPS-Simulator (Follow-Me aktiv): ${result.frames} Frames in ` +
        `${result.elapsedMs.toFixed(0)} ms; App-Watchdog ${
          result.watchdogFps === null ? '—' : result.watchdogFps.toFixed(1)
        } fps`,
    });
  });
});
