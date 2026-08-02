/**
 * Error classes `@yapaja/addon-sdk` throws (docs/05 §3). All extend
 * {@link AddonSdkError}, which carries a machine-readable `code` alongside the
 * usual `Error` message, so add-on code can branch on `err.code` /
 * `instanceof` without parsing strings.
 *
 * NONE of these are enforcement. They exist so an add-on author gets a fast,
 * legible failure -- the host bridge (`apps/web/src/addons/bridge.ts`) and the
 * Core (`apps/core/src/addons/scopeMatrix.ts`) are the only authorities on
 * whether a call is actually permitted, and re-check every single call
 * regardless of what this SDK thinks it knows.
 */

/** Base class for every error this SDK throws. */
export class AddonSdkError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = new.target.name;
    this.code = code;
    // Restores the prototype chain under the ES5-target transpilation some
    // consumers' bundlers still use, so `instanceof AddonSdkError` keeps
    // working for subclasses -- cheap, standard, and harmless under ESM/ES2020.
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

/**
 * Thrown when a call was refused because the add-on lacks a required
 * permission scope -- **carries the missing scope name** (`.scope`) and the
 * SDK method that needed it (`.method`), so an add-on author can tell
 * immediately which `permissions` entry their `yapaja-addon.json` is missing,
 * without having to parse a host/Core error string.
 *
 * Raised in two situations, both mapped through the SAME deterministic
 * method -> scope table (`sdkMethods.ts#SDK_METHOD_SCOPES`, mirrored from the
 * host's `METHOD_SCOPES` / the Core's `scopeMatrix.ts`) rather than by
 * parsing a server-authored message string:
 *  - the host/Core rejected the call with a scope-denial code
 *    (`SCOPE_DENIED` over postMessage, `SCOPE_MISSING` over REST/WS);
 *  - (WS topic subscriptions only) the server's `type:'error'` frame already
 *    names the scope explicitly (`required_scope`) -- passed through verbatim
 *    when present, since it is the most precise source available.
 */
export class ScopeDeniedError extends AddonSdkError {
  /** The permission scope (e.g. `"pos.read"`) the add-on's manifest is missing. */
  readonly scope: string;
  /** The SDK method that required it (e.g. `"position.subscribe"`). */
  readonly method: string;

  constructor(method: string, scope: string, detail?: string) {
    super(
      'SCOPE_DENIED',
      `Add-on is missing permission scope "${scope}" required for "${method}". ` +
        `Add "${scope}" to this add-on's yapaja-addon.json "permissions" and reinstall.` +
        (detail ? ` (${detail})` : ''),
    );
    this.method = method;
    this.scope = scope;
  }
}

/**
 * Thrown when the running Core's reported version is not compatible with
 * this SDK build (docs/05 §3). The rule is MAJOR-VERSION EQUALITY -- see
 * `version.ts` for the full rationale. Distinct from the manifest's
 * `core_api` RANGE check the Core's install pipeline performs at install time
 * (Wargame W-11, `apps/core/src/addons/installService.ts`): that check gates
 * whether the add-on may be installed at all; THIS check gates whether the
 * SDK, once actually talking to a live Core, trusts the wire protocol it is
 * about to use.
 */
export class IncompatibleCoreError extends AddonSdkError {
  readonly sdkVersion: string;
  readonly coreVersion: string;

  constructor(sdkVersion: string, coreVersion: string) {
    super(
      'INCOMPATIBLE_CORE',
      `@yapaja/addon-sdk v${sdkVersion} requires the Core's major version to match its own; ` +
        `the connected Core reports v${coreVersion}. Update the add-on SDK dependency or the Core ` +
        `so their major versions align before retrying.`,
    );
    this.sdkVersion = sdkVersion;
    this.coreVersion = coreVersion;
  }
}

/** A transport-level failure: the handshake/socket/fetch itself never
 *  produced a usable response (as opposed to the host/Core answering with an
 *  application-level error). */
export class AddonTransportError extends AddonSdkError {
  constructor(message: string, code = 'TRANSPORT_ERROR') {
    super(code, message);
  }
}

/** A handshake or request that never got a reply within its deadline. */
export class AddonTimeoutError extends AddonSdkError {
  constructor(message: string) {
    super('TIMEOUT', message);
  }
}

/**
 * Thrown synchronously (or as a rejected Promise, matching the method's own
 * return shape) when add-on code calls an SDK method that simply does not
 * exist on the transport it connected over -- e.g. `map.addLayer` from a
 * service add-on (no map in a headless process) or `nav.control.start` from a
 * UI add-on (the iframe bridge has no navigation-control method; only the
 * Core does). Carries `.method` and `.transport` so the message is
 * actionable, not just "not supported".
 */
export class UnsupportedOnTransportError extends AddonSdkError {
  readonly method: string;
  readonly transport: string;

  constructor(method: string, transport: string, reason?: string) {
    super(
      'UNSUPPORTED_ON_TRANSPORT',
      `"${method}" is not available on the ${transport} transport` + (reason ? ` (${reason})` : '.'),
    );
    this.method = method;
    this.transport = transport;
  }
}

/**
 * The RAW wire-level rejection a transport constructs from a host `result`
 * (`{ok:false, error:{code,message}}`) or a REST/WS error body
 * (`{error:{code,message}}` / `{type:'error', code, message}`), BEFORE
 * `sdkMethods.ts#guardScope` has had a chance to reinterpret a scope-denial
 * code into a {@link ScopeDeniedError}. Add-on code will normally see a more
 * specific error class; this one only escapes `guardScope` for a
 * non-scope-denial failure (e.g. `INVALID_PARAMS`, `UPSTREAM_FAILED`), in
 * which case its `.code` is the host/Core's own error code verbatim.
 */
export class RemoteCallError extends AddonSdkError {}
