/**
 * Browser-seitige Messhilfen: CPU-Drosselung, Karten-Bereitschaft,
 * GL-Renderer-Erkennung und die kuenstliche Verschlechterung.
 *
 * Warum die CPU-Drosselung ueber CDP laeuft und nicht ueber die
 * Playwright-Config: `Emulation.setCPUThrottlingRate` ist eine
 * DevTools-Protokoll-Methode ohne Config-Aequivalent. Sie muss VOR der
 * Navigation gesetzt werden, sonst laeuft genau der Teil ungedrosselt, den
 * die Kaltstart-Messung messen soll.
 */

import type { BrowserContext, Page } from '@playwright/test';
import { CPU_THROTTLE_RATE, degradeDelayMs } from './constants.js';

/** Drosselt die CPU des Renderers auf 1/rate. Muss vor `page.goto` laufen. */
export async function throttleCpu(
  context: BrowserContext,
  page: Page,
  rate: number = CPU_THROTTLE_RATE,
): Promise<void> {
  const session = await context.newCDPSession(page);
  await session.send('Emulation.setCPUThrottlingRate', { rate });
}

/**
 * Kuenstliche Verschlechterung (Akzeptanzkriterium 2): verzoegert JEDE
 * Antwort, die die Seite vom Core bekommt, um `PERF_DEGRADE_DELAY_MS`.
 *
 * Ausschliesslich ein TEST-Fixture -- es wird kein Produktionscode angefasst
 * und kein Feature-Flag in die App eingebaut. Ohne gesetzte Variable wird
 * gar keine Route registriert, die Messung laeuft also unveraendert.
 */
export async function installDegradation(page: Page): Promise<number> {
  const delay = degradeDelayMs();
  if (delay <= 0) return 0;
  await page.route('**/*', async (route) => {
    await new Promise((resolve) => setTimeout(resolve, delay));
    await route.continue();
  });
  return delay;
}

/**
 * Installiert VOR dem Laden eine Sonde, die den Zeitpunkt festhaelt, zu dem
 * die Karte interaktiv ist.
 *
 * "Interaktiv" = MapLibre meldet `loaded()` UND `isStyleLoaded()`, d. h. der
 * Style ist geparst und die erste Kachelgeneration ist da -- ab hier reagiert
 * die Karte auf Pan/Zoom mit sichtbarem Inhalt. Der Zeitwert ist
 * `performance.now()`, also die Zeit ab `timeOrigin` = Navigationsbeginn;
 * damit enthaelt die Messung Netzwerk, Parsing, Boot und den ersten Render
 * und nicht nur den Teil nach `page.goto`.
 */
export async function installColdStartProbe(page: Page): Promise<void> {
  await page.addInitScript(() => {
    window.__perfMapInteractiveAt = new Promise<number>((resolve) => {
      const check = (): void => {
        const map = window.__yapajaMapController?.getMap?.();
        if (map && map.loaded() && map.isStyleLoaded()) {
          resolve(performance.now());
          return;
        }
        requestAnimationFrame(check);
      };
      requestAnimationFrame(check);
    });
  });
}

export async function readColdStartMs(page: Page): Promise<number> {
  return page.evaluate(() => window.__perfMapInteractiveAt as Promise<number>);
}

/** Wartet, bis die Karteninstanz existiert und geladen ist. */
export async function waitForMapLoaded(page: Page, timeout = 60_000): Promise<void> {
  await page.waitForFunction(
    () => {
      const map = window.__yapajaMapController?.getMap?.();
      return Boolean(map && map.loaded());
    },
    undefined,
    { timeout },
  );
}

/**
 * Gibt die erzwungene Positionsquelle wieder frei.
 *
 * Notwendig, weil `POST /api/v1/simulator/play` die aktive Quelle
 * prozessweit auf `simulator` festnagelt (docs/07 §2) und
 * `POST /simulator/stop` sie NICHT wieder loest: ein anschliessendes
 * `POST /api/v1/position/browser` antwortet dann mit 409
 * SOURCE_NOT_SELECTABLE, und die WS-Latenzmessung wartet auf eine Position,
 * die nie kommt. Jede Spec, die den Simulator anwirft, raeumt das hier auf.
 */
export async function releasePositionSource(
  request: import('@playwright/test').APIRequestContext,
  baseUrl: string,
): Promise<void> {
  await request
    .put(`${baseUrl}/api/v1/position/source`, { data: { source: 'auto' } })
    .catch(() => undefined);
}

/**
 * Loest die Follow-Me-Pause GENAU SO AUS, WIE ES EIN MENSCH TUT: mit einer
 * echten Zieh-Geste auf der Karte.
 *
 * Waehrend einer Fahrt zentriert Follow-Me die Karte bei jedem Positions-Fix
 * per `jumpTo` (`apps/web/src/map/followMe.ts`). Ein gleichzeitig laufendes
 * `easeTo` wird davon abgebrochen -- gemessen wuerde dann die Abbruchlogik.
 * Die App selbst loest den Konflikt so, dass eine Nutzergeste Follow-Me
 * pausiert (`handleUserInteraction`, nur bei `originalEvent`); die Messung
 * nutzt denselben Weg statt am Store vorbeizugreifen.
 */
export async function pauseFollowMeByUserGesture(page: Page): Promise<void> {
  const canvas = page.locator('canvas.maplibregl-canvas');
  const box = await canvas.boundingBox();
  if (!box) throw new Error('Karten-Canvas hat keine Bounding-Box');
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;
  await page.mouse.move(cx, cy);
  await page.mouse.down();
  await page.mouse.move(cx + 20, cy + 10, { steps: 4 });
  await page.mouse.up();
}

/**
 * Liest den effektiven WebGL-Renderer aus.
 *
 * Das ist die Grundlage fuer die `advisory`-Einstufung der fps-Metriken:
 * enthaelt der String "SwiftShader"/"llvmpipe"/"software", rastert der
 * Browser in SOFTWARE. Ein fps-Wert daraus sagt etwas ueber den Messstand
 * aus, nicht ueber das Produkt auf einem N100 mit iGPU -- und wird deshalb
 * gemessen, berichtet, aber nicht als Merge-Gate verwendet. Die SCHWELLE
 * (30 fps) bleibt davon unberuehrt.
 */
export async function readGlRenderer(page: Page): Promise<string> {
  return page.evaluate(() => {
    const canvas = document.createElement('canvas');
    const gl = canvas.getContext('webgl') as WebGLRenderingContext | null;
    if (!gl) return 'kein WebGL-Kontext';
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    const renderer = ext
      ? (gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) as string)
      : (gl.getParameter(gl.RENDERER) as string);
    return String(renderer);
  });
}

const SOFTWARE_RENDERER_MARKERS = ['swiftshader', 'llvmpipe', 'software', 'softwarerasterizer'];

export function isSoftwareRenderer(renderer: string): boolean {
  const lower = renderer.toLowerCase();
  return SOFTWARE_RENDERER_MARKERS.some((marker) => lower.includes(marker));
}

export const SOFTWARE_RENDERER_ADVISORY =
  'Der Messcontainer hat keine GPU: WebGL laeuft ueber SwiftShader in Software-Rasterung. ' +
  'Der Zielrechner (Intel N100) rendert auf einer iGPU. Der Messwert ist damit eine ' +
  'strukturell pessimistische Untergrenze und KEINE Aussage ueber das Produkt -- er wird ' +
  'voll berichtet, aber nicht als Merge-Gate verwendet. Die 30-fps-Schwelle bleibt ' +
  'unveraendert; zertifizieren laesst sie sich nur auf Hardware mit echter GPU ' +
  '(self-hosted Runner / das N100-Zielgeraet).';
