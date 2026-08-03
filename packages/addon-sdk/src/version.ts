/**
 * The add-on SDK's own version + its Core-compatibility check (docs/05 §3).
 *
 * Every add-on connects to a SPECIFIC running Core. The Core reports its own
 * version at `GET /api/v1/health` (`{ version, ... }`, see
 * `apps/core/src/index.ts` / `apps/core/src/version.ts`) -- the SAME string
 * the install pipeline already checks a manifest's `core_api` RANGE against
 * (Wargame W-11, `apps/core/src/addons/installService.ts#satisfies`). This
 * module is a SEPARATE, narrower, SDK-side check: does the Core the SDK is
 * actually talking to right now understand the wire protocol THIS SDK BUILD
 * was written against?
 *
 * The rule is deliberately simple: **the SDK's major version must equal the
 * Core's major version.** A minor/patch drift either way is fine (that's the
 * whole point of semver -- additive/compatible changes bump minor/patch); a
 * MAJOR drift means a breaking wire-protocol change may have shipped on one
 * side without the other, so the SDK refuses to guess and throws
 * {@link IncompatibleCoreError} up front instead of silently misbehaving
 * against an API surface it was never built against.
 *
 * DELIBERATELY NOT `import { isValidSemver } from '@yapaja/shared'` (found
 * while building the E09-T5 reference add-ons): `@yapaja/shared`'s package
 * entry point (`src/index.ts`) also re-exports `validators.ts`, which runs
 * `ajv.compile(...)` -- AJV's default strategy generates and evaluates
 * validator functions via `new Function(...)` -- as a MODULE-LOAD-TIME side
 * effect. ES module semantics evaluate a whole imported module's top-level
 * code the moment ANY of its exports is imported, so merely importing
 * `isValidSemver` transitively ran that `new Function(...)` call too. A UI
 * add-on's sandboxed iframe CSP (`script-src ... `, deliberately NO
 * `'unsafe-eval'`, see `apps/core/src/addons/ui-host.ts#buildAddonCsp`)
 * refuses that outright -- so EVERY UI add-on calling `connectAddon()` (the
 * SDK's own entry point, which this module is reachable from) would hard-
 * fail at load with a CSP violation, regardless of whether
 * `assertCoreCompatible`/`isCoreCompatible` are ever actually called.
 * `protocol.ts`'s `AddonScope` already keeps its own local copy instead of a
 * runtime `@yapaja/shared` dependency for the same class of reason ("the
 * public SDK has no dependency on the Core's shared package") -- this is
 * that same rule applied here. The two-line regex below is the exact subset
 * `@yapaja/shared/src/semver.ts#isValidSemver` implements (full, valid
 * `major.minor.patch[-prerelease]`, no `v` prefix, no partial versions).
 */

import { IncompatibleCoreError } from './errors.js';

const SEMVER_RE = /^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)(?:-[0-9A-Za-z-][0-9A-Za-z.-]*)?$/;

function isValidSemver(version: string): boolean {
  return typeof version === 'string' && SEMVER_RE.test(version.trim());
}

/**
 * This SDK build's own version. MUST be kept in sync with `package.json`'s
 * `version` field by convention (a literal, not read from `package.json` at
 * runtime, so it survives being bundled into an add-on's own build output --
 * unlike a Core module, this file may end up shipped inside a THIRD PARTY'S
 * bundle with no `package.json` alongside it at runtime).
 */
export const ADDON_SDK_VERSION = '0.1.0';

function majorOf(version: string): number {
  return Number(version.split('.')[0]);
}

/**
 * True when `coreVersion`'s major component equals `sdkVersion`'s (default:
 * this build's own {@link ADDON_SDK_VERSION}). An invalid (non-semver) string
 * on either side is treated as INCOMPATIBLE rather than thrown -- callers
 * that want to distinguish "invalid version string" from "genuine major
 * mismatch" should validate with `isValidSemver` themselves first.
 */
export function isCoreCompatible(coreVersion: string, sdkVersion: string = ADDON_SDK_VERSION): boolean {
  if (!isValidSemver(coreVersion) || !isValidSemver(sdkVersion)) return false;
  return majorOf(coreVersion) === majorOf(sdkVersion);
}

/**
 * Throws {@link IncompatibleCoreError} unless {@link isCoreCompatible} holds.
 * Called once, right after a service add-on's transport learns the Core's
 * version from `GET /api/v1/health` (see `serviceTransport.ts`); a
 * `connectAddon()` caller can opt out via `skipCoreCompatibilityCheck: true`
 * for the rare case (e.g. talking to a dev Core mid-major-bump) where the
 * author has already confirmed compatibility by hand.
 */
export function assertCoreCompatible(coreVersion: string, sdkVersion: string = ADDON_SDK_VERSION): void {
  if (!isCoreCompatible(coreVersion, sdkVersion)) {
    throw new IncompatibleCoreError(sdkVersion, coreVersion);
  }
}
