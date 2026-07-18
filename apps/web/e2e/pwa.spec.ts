/**
 * E07-T5 (PWA & Kiosk): Service Worker registration + app-shell precache,
 * plus the two mandatory proofs from the task itself:
 *
 *  1. Cold-start offline (Flow 1, task's own words: "this is the whole
 *     point of the PWA"): load once online (the SW installs, precaches the
 *     app shell, and -- `clientsClaim: true` -- takes control of the
 *     already-open page), then cut the network ENTIRELY
 *     (`context.setOffline(true)`, stricter than reality: a real kiosk's
 *     "offline" still has the local Core reachable, this blocks even
 *     localhost) and reload. The app shell must still boot -- mount, show
 *     its persistent chrome -- served straight out of the SW's Cache
 *     Storage, no network involved.
 *  2. PLAUSIBILITY: after genuine online use (tiles + API requests really
 *     happen), NEITHER `/api/*` NOR `/tiles/*` ever lands in ANY
 *     `CacheStorage` entry -- see `src/pwa/cachePolicy.ts` and
 *     `vite.config.ts`'s workbox config for why (a cached copy would serve
 *     ghost/stale data after an app update or mid-drive).
 *
 * The THIRD mandatory proof -- reload-recovery (W-19 "Navigation
 * fortsetzen?") still working with the SW active -- is deliberately NOT
 * duplicated here: `nav-control.spec.ts`'s existing W-19 test already covers
 * it end-to-end. The SW is registered globally from `main.tsx`, but
 * `playwright.config.ts` BLOCKS it by default (it added per-fetch overhead
 * that flaked the tight-budget search/favorites/gps-loss specs under CI
 * contention); the specs that need it opt back in with
 * `test.use({ serviceWorkers: 'allow' })` -- this file, and the
 * `nav-control.spec.ts` describe that owns the W-19 recovery test -- so that
 * recovery-with-SW proof still runs with the SW genuinely active. See this
 * task's verification command list (`pwa.spec.ts offline-network.spec.ts
 * subpath.spec.ts nav-control.spec.ts`) for the same reasoning.
 *
 * Own dedicated core (`PWA_CORE_PORT`) per the harness's one-core-per-spec
 * convention -- see constants.ts's comment for why.
 */
import { test, expect, type Page } from '@playwright/test';
import { PWA_CORE_BASE_URL } from './support/constants.js';
import { collectPageErrors } from './support/network.js';

// This spec is the whole point of having a Service Worker, so opt back IN to
// the SW that `playwright.config.ts` blocks by default (see that file's
// comment for why the default is `block`). Scoped to this file only.
test.use({ serviceWorkers: 'allow' });

/** Resolves once the page's own Service Worker registration is `active` AND
 *  is the page's controller (i.e. `clientsClaim` has actually run) -- proof
 *  that install (including the precaching step) has fully completed. Returns
 *  the controlling worker's script URL.
 *
 *  Uses `expect.poll` (re-running the WHOLE check, including the read of
 *  `controller.scriptURL`, on every retry) rather than a one-shot
 *  `page.waitForFunction` followed by a separate `page.evaluate` -- under
 *  heavy parallel load (many dedicated e2e cores + browsers competing for
 *  CPU, see constants.ts's comments), a two-step "wait, then separately
 *  read" was observed to occasionally read a stale/incomplete state even
 *  after the wait resolved. Folding both into one polled check removes that
 *  race entirely: whatever `expect.poll` last saw is exactly what the
 *  assertion below checks. Generous timeout for the same CPU-contention
 *  reason (task's own hint: "prefer asserting on `navigator.serviceWorker`
 *  readiness explicitly" when a SW makes a spec flaky). */
async function readControllerScriptUrl(page: Page): Promise<string | null> {
  return page.evaluate(async () => {
    if (!('serviceWorker' in navigator)) return null;
    const registration = await navigator.serviceWorker.getRegistration();
    if (!registration?.active) return null;
    return navigator.serviceWorker.controller?.scriptURL ?? null;
  });
}

async function waitForServiceWorkerControllerUrl(page: Page): Promise<string> {
  let lastUrl: string | null = null;
  await expect
    .poll(
      async () => {
        lastUrl = await readControllerScriptUrl(page);
        return lastUrl;
      },
      { timeout: 20_000, message: 'Service Worker never became the page controller' },
    )
    .not.toBeNull();
  return lastUrl as unknown as string;
}

/** Simple boolean form of the above, for call sites that don't need the URL. */
async function waitForServiceWorkerActive(page: Page): Promise<void> {
  await waitForServiceWorkerControllerUrl(page);
}

test.describe('PWA: manifest + Service Worker (E07-T5)', () => {
  test('a valid manifest is linked from index.html (installability: name, icons, display, orientation)', async ({
    page,
  }) => {
    await page.goto(PWA_CORE_BASE_URL + '/');

    const manifestHref = await page.locator('link[rel="manifest"]').getAttribute('href');
    expect(manifestHref).toBeTruthy();
    const manifestUrl = new URL(manifestHref as string, page.url()).toString();

    const manifestResponse = await page.request.get(manifestUrl);
    expect(manifestResponse.ok()).toBe(true);
    const manifest = await manifestResponse.json();

    expect(manifest.name).toBe('Yapaja Go');
    expect(manifest.display).toBe('fullscreen');
    expect(manifest.orientation).toBe('any');
    expect(manifest.background_color).toBe('#111417');

    const sizes: string[] = manifest.icons.map((icon: { sizes: string }) => icon.sizes);
    expect(sizes.some((s) => s.includes('192'))).toBe(true);
    expect(sizes.some((s) => s.includes('512'))).toBe(true);
    expect(
      manifest.icons.some((icon: { purpose?: string }) => icon.purpose?.includes('maskable')),
    ).toBe(true);

    // Every icon file the manifest points at must actually exist and be a real image.
    for (const icon of manifest.icons as Array<{ src: string }>) {
      const iconUrl = new URL(icon.src, manifestUrl).toString();
      const iconResponse = await page.request.get(iconUrl);
      expect(iconResponse.ok()).toBe(true);
      expect(iconResponse.headers()['content-type']).toContain('image/png');
    }
  });

  test('the Service Worker registers, installs, and takes control of the page', async ({ page }) => {
    const pageErrors = collectPageErrors(page);
    await page.goto(PWA_CORE_BASE_URL + '/');

    const controllerScriptUrl = await waitForServiceWorkerControllerUrl(page);
    expect(controllerScriptUrl).toContain('/sw.js');

    expect(pageErrors).toEqual([]);
  });

  test('both app-shell entries (index.html and shell.html) are precached', async ({ page }) => {
    await page.goto(PWA_CORE_BASE_URL + '/');
    await waitForServiceWorkerActive(page);

    const precachedUrls: string[] = await page.evaluate(async () => {
      const names = await caches.keys();
      const urls: string[] = [];
      for (const name of names) {
        const cache = await caches.open(name);
        const requests = await cache.keys();
        urls.push(...requests.map((r) => new URL(r.url).pathname));
      }
      return urls;
    });

    expect(precachedUrls.some((p) => p.endsWith('/index.html'))).toBe(true);
    expect(precachedUrls.some((p) => p.endsWith('/shell.html'))).toBe(true);
    expect(precachedUrls.some((p) => p.endsWith('manifest.webmanifest'))).toBe(true);
  });

  test('PLAUSIBILITY: /api/* and /tiles/* are never written into any Cache Storage entry', async ({ page }) => {
    await page.goto(PWA_CORE_BASE_URL + '/');
    // Real online use: let the map actually load tiles + region data.
    await expect(page.locator('canvas.maplibregl-canvas')).toBeVisible({ timeout: 15_000 });
    await waitForServiceWorkerActive(page);
    // Give any in-flight tile/API requests (and the SW's own fetch-event
    // handling of them) a moment to settle.
    await page.waitForTimeout(1_000);

    const cachedUrls: string[] = await page.evaluate(async () => {
      const names = await caches.keys();
      const urls: string[] = [];
      for (const name of names) {
        const cache = await caches.open(name);
        const requests = await cache.keys();
        urls.push(...requests.map((r) => r.url));
      }
      return urls;
    });

    // Sanity: the assertion below isn't vacuously true because nothing was
    // ever cached at all -- the app shell precache DID populate a cache.
    expect(cachedUrls.length).toBeGreaterThan(0);

    expect(cachedUrls.some((u) => u.includes('/api/'))).toBe(false);
    expect(cachedUrls.some((u) => u.includes('/tiles/'))).toBe(false);
  });

  test('Flow 1 (cold-start offline): the app shell still boots with the network fully cut', async ({
    page,
    context,
  }) => {
    test.setTimeout(45_000);
    const pageErrors = collectPageErrors(page);

    await page.goto(PWA_CORE_BASE_URL + '/');
    await waitForServiceWorkerActive(page);
    // Small settle margin: `clientsClaim()`'s own bookkeeping resolves
    // asynchronously right around when `controller` first becomes visible --
    // under heavy parallel CPU load (many dedicated e2e cores + browsers,
    // see constants.ts) leave it a beat before yanking the network away.
    await page.waitForTimeout(300);

    await context.setOffline(true);
    try {
      await page.reload();

      // The app shell's persistent chrome (App.tsx's header) must still
      // render -- served from the SW's precache, no network round-trip.
      await expect(page.locator('header')).toContainText('Yapaja Go', { timeout: 10_000 });
      // The React tree actually mounted (not a blank/crashed root).
      await expect(page.locator('#root')).not.toBeEmpty();
    } finally {
      await context.setOffline(false);
    }

    expect(pageErrors).toEqual([]);
  });
});
