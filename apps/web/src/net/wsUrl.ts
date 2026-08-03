/**
 * The ONE place the app derives its `/ws/v1` WebSocket URL (E10-T1).
 *
 * Extracted because the same ~10 lines were copy-pasted into all THREE
 * WebSocket managers — `position/positionStore.ts`, `drive/navStore.ts` and
 * `shell/wsStore.ts` — which meant they also all shared the same bug, and a
 * fix in one would silently leave the other two broken.
 *
 * THE BUG (found by docs/07 §5 flow 9, `e2e/subpath.spec.ts`, once the ingress
 * simulation was extended to actually exercise WebSockets):
 *
 *     new URL(basePath, window.location.origin).pathname
 *
 * `basePath` is `import.meta.env.BASE_URL`, and this app is built with Vite's
 * `base: './'` — i.e. the RELATIVE string `'./'`. Resolving a relative base
 * against `window.location.origin` (`https://host/`, always the root) yields
 * `/`, discarding any sub-path the app is actually served under. Served at
 * `https://host/hassio_ingress/<token>/`, all three sockets therefore dialled
 * `wss://host/ws/v1` — a path Home Assistant ingress does not route — so under
 * ingress the live position, the navigation stream and the widget shell all
 * silently never connected.
 *
 * Resolving against `window.location.href` instead keeps the document's
 * directory (`/hassio_ingress/<token>/`) and is byte-identical at the root.
 * The REST clients were never affected: they build relative URL STRINGS
 * (`` `${import.meta.env.BASE_URL}${path}` ``) which the browser resolves
 * against the document itself.
 */

/** Where the page is served from — injectable so this is testable without a DOM. */
export interface WsUrlLocation {
  /** `window.location.protocol`, e.g. `'https:'`. */
  protocol: string;
  /** `window.location.host`, e.g. `'nav.example:8123'`. */
  host: string;
  /** `window.location.href` — the CURRENT DOCUMENT, not the origin. */
  href: string;
}

/**
 * Builds the absolute `ws(s)://…/ws/v1` URL for `basePath` as served from
 * `location`.
 *
 * @param basePath `import.meta.env.BASE_URL` (typically the relative `'./'`).
 */
export function buildWebSocketUrl(basePath: string, location: WsUrlLocation): string {
  const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
  const directory = new URL(basePath || './', location.href).pathname;
  const fullPath = directory.endsWith('/') ? `${directory}ws/v1` : `${directory}/ws/v1`;
  return `${protocol}//${location.host}${fullPath}`;
}

/** Reads the live `window.location`, throwing outside a browser. */
export function currentWsUrlLocation(): WsUrlLocation {
  if (typeof window === 'undefined') {
    throw new Error('WebSocket is not available in this environment');
  }
  return {
    protocol: window.location.protocol,
    host: window.location.host,
    href: window.location.href,
  };
}
