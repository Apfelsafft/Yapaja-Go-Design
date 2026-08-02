/**
 * Transport auto-detection (docs/05 §3): `connectAddon()` needs to know,
 * with ZERO configuration from the add-on author, whether it is running as a
 * UI add-on (sandboxed iframe, talks postMessage to the host,
 * `apps/web/src/addons/bridge.ts`) or a service add-on (Core-spawned child
 * process / `runtime: external` container, talks REST+WS to the Core,
 * `apps/core/src/addons/service-host.ts`).
 *
 * The two runtimes give unambiguous, mutually exclusive signals:
 *  - A service add-on is handed `YAPAJA_TOKEN` (its scoped bearer token) in
 *    `process.env` -- see `service-host.ts`'s "THE PROCESS CONTRACT". This is
 *    a deliberate, Core-issued credential; nothing else sets it.
 *  - A UI add-on runs inside a `sandbox="allow-scripts"` iframe, so it has a
 *    `window` (and a distinct `window.parent` it posts to) but no Node
 *    `process` global at all -- the sandboxed iframe is a browser context,
 *    full stop.
 *
 * The env check runs FIRST and wins outright if (implausibly) both signals
 * are present at once -- e.g. a Node-based test harness that also polyfills
 * `window` for some unrelated reason. `YAPAJA_TOKEN` is the stronger,
 * deliberate signal; "a `window` object merely exists" is not.
 */

import { AddonTransportError } from './errors.js';

export type TransportKind = 'postMessage' | 'service';

/** Reads `process.env.YAPAJA_TOKEN` without assuming `process` exists (it
 *  does not, in a browser/iframe context) -- guarded via `globalThis` so this
 *  module loads safely in either runtime. */
function serviceToken(): string | undefined {
  const proc = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process;
  return proc?.env?.YAPAJA_TOKEN;
}

function hasServiceEnv(): boolean {
  const token = serviceToken();
  return typeof token === 'string' && token.trim() !== '';
}

function hasPostMessageEnv(): boolean {
  return typeof window !== 'undefined' && typeof window.parent !== 'undefined';
}

/**
 * Picks the transport `connectAddon()` should use. Throws
 * {@link AddonTransportError} when NEITHER signal is present (e.g. this SDK
 * imported into a plain Node script or a `vitest` test with no mocks set up)
 * -- callers in that situation must pass `{ transport: 'postMessage' |
 * 'service' }` explicitly to `connectAddon()`.
 */
export function detectTransport(): TransportKind {
  if (hasServiceEnv()) return 'service';
  if (hasPostMessageEnv()) return 'postMessage';
  throw new AddonTransportError(
    'Could not auto-detect a transport: no YAPAJA_TOKEN env var (service add-on contract) and no ' +
      'window.parent (UI add-on contract). Pass { transport: "postMessage" | "service" } to connectAddon() explicitly.',
    'TRANSPORT_DETECTION_FAILED',
  );
}
