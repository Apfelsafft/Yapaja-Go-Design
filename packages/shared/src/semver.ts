/**
 * Minimal, dependency-free semver helpers (E09-T1, docs/05 §2/§3): the
 * add-on manifest's `version` field must be a valid semver, and `core_api`
 * must be a valid semver RANGE that the install pipeline checks against the
 * running Core's version (Wargame W-11: an add-on whose `core_api` doesn't
 * satisfy the Core version is rejected at install, and -- in a later task --
 * disabled rather than crashing on a Core update).
 *
 * This deliberately hand-rolls the (small) subset of the npm-semver range
 * grammar this codebase actually needs, rather than pulling in the `semver`
 * package, to keep `@yapaja/shared` dependency-free beyond ajv. Supported:
 *
 *  - exact versions:      "1.2.3", "1.2.3-beta.1"
 *  - caret ranges:        "^1.2.3", "^0.2.3", "^0.0.3", "^1.2", "^1", "^1.x"
 *  - tilde ranges:        "~1.2.3", "~1.2", "~1"
 *  - x-ranges (implicit): "1.2.x", "1.2", "1.x", "1", "*", "x"
 *
 * NOT supported (out of scope for this task, will throw/return false):
 * comparator combinations ("1.2.3 - 2.0.0", ">=1.0.0 <2.0.0"), OR ranges
 * ("1.x || 2.x"), build metadata comparison. If a future task needs those,
 * swap this module for the real `semver` package rather than extending the
 * hand-rolled parser indefinitely.
 *
 * Caret/tilde semantics follow node-semver's documented behaviour
 * (https://github.com/npm/node-semver#caret-ranges-123-025-004) including
 * the "first non-zero component" rule for partial caret ranges.
 */

/** A parsed `major.minor.patch[-prerelease]` version. */
interface ParsedVersion {
  major: number;
  minor: number;
  patch: number;
  prerelease: string | null;
}

/** A concrete component (`number`) or a wildcard (`'x'`), used while
 *  parsing ranges -- a bare/omitted component is treated as a wildcard. */
type RangeComponent = number | 'x';

interface ParsedRange {
  operator: '^' | '~' | null;
  major: RangeComponent;
  minor: RangeComponent;
  patch: RangeComponent;
  prerelease: string | null;
}

// Numeric identifiers must not carry leading zeros ("0" is fine, "01" isn't)
// -- same rule as the official semver.org grammar.
const NUM = '(?:0|[1-9]\\d*)';
const VERSION_RE = new RegExp(`^(${NUM})\\.(${NUM})\\.(${NUM})(?:-([0-9A-Za-z-][0-9A-Za-z.-]*))?$`);

// Range grammar: optional ^/~, then 1-3 dot-separated components where each
// component is either digits (no leading zeros) or a wildcard (x/X/*), then
// an optional prerelease tag (only meaningful when all three components are
// concrete).
const RANGE_RE = new RegExp(
  `^(\\^|~)?(${NUM}|[xX*])(?:\\.(${NUM}|[xX*]))?(?:\\.(${NUM}|[xX*]))?(?:-([0-9A-Za-z-][0-9A-Za-z.-]*))?$`,
);

/** Parses a strict `major.minor.patch[-prerelease]` version string, or
 *  returns `null` if it isn't one (no partial versions, no leading `v`,
 *  no build metadata -- those are all range-only or non-semver ideas). */
function parseVersion(version: string): ParsedVersion | null {
  const match = VERSION_RE.exec(version.trim());
  if (!match) return null;
  const [, major, minor, patch, prerelease] = match;
  return {
    major: Number(major),
    minor: Number(minor),
    patch: Number(patch),
    prerelease: prerelease ?? null,
  };
}

/** Type guard / validator: is `version` a valid, exact semver string? */
export function isValidSemver(version: string): boolean {
  return typeof version === 'string' && parseVersion(version) !== null;
}

function parseComponent(raw: string | undefined): RangeComponent {
  if (raw === undefined || raw === 'x' || raw === 'X' || raw === '*') return 'x';
  return Number(raw);
}

function parseRange(range: string): ParsedRange | null {
  const trimmed = range.trim();
  if (trimmed === '' || trimmed === '*' || trimmed.toLowerCase() === 'x') {
    return { operator: null, major: 'x', minor: 'x', patch: 'x', prerelease: null };
  }
  const match = RANGE_RE.exec(trimmed);
  if (!match) return null;
  const [, operator, major, minor, patch, prerelease] = match;
  return {
    operator: (operator as '^' | '~' | undefined) ?? null,
    major: parseComponent(major),
    minor: parseComponent(minor),
    patch: parseComponent(patch),
    prerelease: prerelease ?? null,
  };
}

/** Type guard / validator: is `range` a valid semver range this module
 *  understands (see the module doc for the supported grammar subset)? */
export function isValidRange(range: string): boolean {
  return typeof range === 'string' && parseRange(range) !== null;
}

/** Compares two `[major, minor, patch]` numeric tuples. */
function compareTuples(a: readonly [number, number, number], b: readonly [number, number, number]): number {
  for (let i = 0; i < 3; i++) {
    if (a[i] !== b[i]) return a[i] < b[i] ? -1 : 1;
  }
  return 0;
}

/** Compares prerelease identifiers per semver precedence rules: numeric
 *  identifiers compare numerically, alphanumeric compare lexically, and a
 *  larger set of fields wins when all shared fields are equal. */
function comparePrerelease(a: string | null, b: string | null): number {
  if (a === b) return 0;
  // No prerelease has HIGHER precedence than any prerelease (1.0.0 > 1.0.0-rc.1).
  if (a === null) return 1;
  if (b === null) return -1;
  const partsA = a.split('.');
  const partsB = b.split('.');
  const len = Math.max(partsA.length, partsB.length);
  for (let i = 0; i < len; i++) {
    const pa = partsA[i];
    const pb = partsB[i];
    if (pa === undefined) return -1;
    if (pb === undefined) return 1;
    const na = /^\d+$/.test(pa) ? Number(pa) : null;
    const nb = /^\d+$/.test(pb) ? Number(pb) : null;
    if (na !== null && nb !== null) {
      if (na !== nb) return na < nb ? -1 : 1;
    } else if (na !== null) {
      return -1; // numeric identifiers always have lower precedence than alphanumeric.
    } else if (nb !== null) {
      return 1;
    } else if (pa !== pb) {
      return pa < pb ? -1 : 1;
    }
  }
  return 0;
}

/** Full semver precedence comparison: -1 if `a` < `b`, 0 if equal, 1 if `a` > `b`. */
export function compareVersions(a: string, b: string): number {
  const pa = parseVersion(a);
  const pb = parseVersion(b);
  if (!pa || !pb) {
    throw new Error(`compareVersions: not a valid semver (${JSON.stringify({ a, b })})`);
  }
  const core = compareTuples([pa.major, pa.minor, pa.patch], [pb.major, pb.minor, pb.patch]);
  if (core !== 0) return core;
  return comparePrerelease(pa.prerelease, pb.prerelease);
}

/** Lower/upper bound for a caret range, per node-semver's "first non-zero
 *  component decides the ceiling" rule. `upper === null` means unbounded. */
function caretBounds(
  major: RangeComponent,
  minor: RangeComponent,
  patch: RangeComponent,
): { lower: [number, number, number]; upper: [number, number, number] | null } {
  const M = major === 'x' ? 0 : major;
  if (major !== 'x' && M !== 0) {
    const m = minor === 'x' ? 0 : minor;
    const p = patch === 'x' ? 0 : patch;
    return { lower: [M, m, p], upper: [M + 1, 0, 0] };
  }
  // major is 0 or wildcard.
  if (major === 'x') {
    return { lower: [0, 0, 0], upper: null }; // "^x" -- match anything (degenerate).
  }
  if (minor !== 'x' && minor !== 0) {
    const p = patch === 'x' ? 0 : patch;
    return { lower: [0, minor, p], upper: [0, minor + 1, 0] };
  }
  if (minor === 'x') {
    return { lower: [0, 0, 0], upper: [1, 0, 0] }; // "^0.x"
  }
  // minor === 0 here.
  if (patch !== 'x' && patch !== 0) {
    return { lower: [0, 0, patch], upper: [0, 0, patch + 1] };
  }
  if (patch === 'x') {
    return { lower: [0, 0, 0], upper: [0, 1, 0] }; // "^0.0.x"
  }
  return { lower: [0, 0, 0], upper: [0, 0, 1] }; // "^0.0.0" / "^0.0"
}

/** Lower/upper bound for a tilde range: patch-level freedom if a minor was
 *  given, else minor-level freedom. */
function tildeBounds(
  major: RangeComponent,
  minor: RangeComponent,
  patch: RangeComponent,
): { lower: [number, number, number]; upper: [number, number, number] } {
  const M = major === 'x' ? 0 : major;
  if (minor === 'x') {
    return { lower: [M, 0, 0], upper: [M + 1, 0, 0] };
  }
  const p = patch === 'x' ? 0 : patch;
  return { lower: [M, minor, p], upper: [M, minor + 1, 0] };
}

/** Lower/upper bound for a bare x-range / partial version with no operator
 *  ("1.2.x", "1.2", "1", "*"). `upper === null` means unbounded ("*"/"x"). */
function xRangeBounds(
  major: RangeComponent,
  minor: RangeComponent,
  patch: RangeComponent,
): { lower: [number, number, number]; upper: [number, number, number] | null } {
  if (major === 'x') {
    return { lower: [0, 0, 0], upper: null };
  }
  if (minor === 'x') {
    return { lower: [major, 0, 0], upper: [major + 1, 0, 0] };
  }
  if (patch === 'x') {
    return { lower: [major, minor, 0], upper: [major, minor + 1, 0] };
  }
  // All three concrete -- exact version, handled by the caller before this
  // is reached, but computed here too for completeness (single-point range).
  return { lower: [major, minor, patch], upper: [major, minor, patch + 1] };
}

/**
 * Does `version` (a full, valid semver) satisfy `range`? Both are validated
 * internally -- an invalid version or range returns `false` rather than
 * throwing, so callers can use this directly as a boolean gate.
 *
 * Prerelease versions only satisfy a range that pins the EXACT same
 * `major.minor.patch-prerelease` (standard semver behaviour: prereleases
 * are excluded from ranges unless explicitly matched) -- e.g. `1.2.3-beta`
 * does NOT satisfy `^1.2.3`.
 */
export function satisfies(version: string, range: string): boolean {
  const v = parseVersion(version);
  const r = parseRange(range);
  if (!v || !r) return false;

  const vTuple: [number, number, number] = [v.major, v.minor, v.patch];

  if (v.prerelease !== null) {
    // Prerelease versions only ever satisfy an EXACT range for the exact
    // same prerelease tag (e.g. range "1.2.3-beta" -- three concrete
    // components with a matching prerelease). Anything else (caret, tilde,
    // wildcard, or an exact range for a different/no prerelease) rejects.
    if (r.operator !== null) return false;
    if (r.major === 'x' || r.minor === 'x' || r.patch === 'x') return false;
    return (
      compareTuples(vTuple, [r.major, r.minor, r.patch]) === 0 && r.prerelease === v.prerelease
    );
  }

  if (r.operator === '^') {
    const { lower, upper } = caretBounds(r.major, r.minor, r.patch);
    if (compareTuples(vTuple, lower) < 0) return false;
    return upper === null || compareTuples(vTuple, upper) < 0;
  }

  if (r.operator === '~') {
    const { lower, upper } = tildeBounds(r.major, r.minor, r.patch);
    return compareTuples(vTuple, lower) >= 0 && compareTuples(vTuple, upper) < 0;
  }

  // No operator: exact version (all concrete, no wildcards) or an x-range.
  if (r.major !== 'x' && r.minor !== 'x' && r.patch !== 'x') {
    return compareTuples(vTuple, [r.major, r.minor, r.patch]) === 0;
  }
  const { lower, upper } = xRangeBounds(r.major, r.minor, r.patch);
  if (compareTuples(vTuple, lower) < 0) return false;
  return upper === null || compareTuples(vTuple, upper) < 0;
}
