/**
 * PLAUSIBILITY (E07-T5, task's own words): the Service Worker must NEVER
 * cache `/api/*` or `/tiles/*` -- both come LIVE from the local Core (map
 * tiles + all API), so a cached copy would serve ghost/stale data after an
 * app update or mid-drive.
 *
 * This module is the single source of truth for that denylist:
 *  - `vite.config.ts` feeds it into Workbox's `runtimeCaching` as explicit
 *    `NetworkOnly` routes (so the exclusion is provable in the generated
 *    SW -- `grep`-able -- not just "absence of a rule"; see that file's
 *    comment for why an explicit route is used instead of just relying on
 *    "never precached, never routed").
 *  - `cachePolicy.test.ts` unit-tests the predicate directly.
 *  - `apps/web/e2e/pwa.spec.ts` proves the real, built-and-served SW never
 *    writes either path into any `CacheStorage` entry.
 *
 * `.includes(...)`, not `.startsWith(...)`: the app is deployed both at
 * origin root AND under an arbitrary ingress sub-path (W-15, `base: './'`,
 * `apps/web/e2e/subpath.spec.ts`) -- a sub-path request is
 * `/rv-demo/api/v1/...`, which doesn't START WITH `/api/` but does CONTAIN
 * it. The denylist must hold under both deployment shapes.
 */
export const NEVER_CACHE_PATH_SEGMENTS = ['/api/', '/tiles/'] as const;

export function isNeverCachePath(pathname: string): boolean {
  return NEVER_CACHE_PATH_SEGMENTS.some((segment) => pathname.includes(segment));
}
