/**
 * 🔴 Restriction provenance, established OFFLINE from the routed dataset
 * (E10-T3, W-08).
 *
 * Why this module exists at all
 * ----------------------------
 * Every DE restriction case in `golden-routes.json` carries
 * `restriction.osm_way_id: null` and `unverified: true`: nobody has ever read
 * the tag that the case claims to test. Filling those fields by hand — from
 * memory, from a web page, from an estimate — would be the worst possible
 * outcome, because it makes an unverified safety case LOOK verified.
 *
 * The honest source is the PBF the nightly job already downloads and builds
 * the Valhalla graph from. If a `maxheight` is in THAT file, the router can
 * see it; if it is not, no amount of Overpass evidence makes the case
 * meaningful. So provenance is established from the same bytes the router
 * routes on — which is strictly stronger evidence than an Overpass lookup
 * against today's live OSM.
 *
 * This file is the pure half of that pipeline: no filesystem, no network, no
 * osmium. `scripts/osm-restriction-provenance.sh` does the extraction and
 * pipes GeoJSONSeq into `provenanceCli.ts`, which calls the functions here.
 * Keeping the judgement pure means the matching/parsing rules are provable in
 * `provenance.test.ts` without a 4 GB download.
 */

import type { Bbox } from './bbox.js';
import type { GoldenCase, RestrictionCase } from './types.js';

/** The OSM tag keys that carry each restriction kind, in priority order. */
export const TAG_KEYS: Record<RestrictionCase['restriction']['kind'], readonly string[]> = {
  maxheight: ['maxheight', 'maxheight:physical', 'maxheight:signed'],
  maxweight: ['maxweight', 'maxweight:signed', 'maxweightrating'],
  maxwidth: ['maxwidth', 'maxwidth:physical', 'maxwidth:signed'],
};

/** A way extracted from the PBF, reduced to what a provenance decision needs. */
export interface OsmWayCandidate {
  osm_way_id: number;
  tags: Readonly<Record<string, string>>;
  /** Bounding box of the way's geometry, `[minLon, minLat, maxLon, maxLat]`. */
  bbox: Bbox;
}

/** A parsed restriction tag value, normalised to metres or tonnes. */
export interface ParsedTagValue {
  value: number;
  unit: 'm' | 't';
  /** The raw tag text, kept verbatim for the provenance string. */
  raw: string;
}

const FEET_INCH = /^(\d+(?:\.\d+)?)\s*'\s*(?:(\d+(?:\.\d+)?)\s*")?$/;
const NUMBER_UNIT = /^(\d+(?:[.,]\d+)?)\s*([a-z]*)$/i;

/** ASCII record separator (U+001E), the RFC 8142 GeoJSONSeq record prefix. */
const RECORD_SEPARATOR = 0x1e;

/**
 * Parse an OSM `maxheight`/`maxwidth`/`maxweight` value.
 *
 * Returns `null` — never a guess — for everything that does not carry a hard
 * number: `default`, `none`, `unsigned`, `below_default`, `no`, empty text, or
 * anything unparseable. A restriction case whose tag says "default" is NOT a
 * verified restriction, and this function refusing to invent a number is the
 * whole point.
 *
 * Units: metres/tonnes are the OSM defaults for these keys. Explicit `m`,
 * `t`, `kg`, `lbs`, `ft`, and the imperial `12'6"` form are converted; any
 * other unit suffix is rejected rather than silently treated as the default.
 */
export function parseTagValue(
  raw: string,
  kind: RestrictionCase['restriction']['kind'],
): ParsedTagValue | null {
  const text = raw.trim().toLowerCase();
  if (text.length === 0) return null;
  if (['default', 'none', 'no', 'unsigned', 'below_default', 'unknown', 'yes'].includes(text)) {
    return null;
  }

  const targetUnit: 'm' | 't' = kind === 'maxweight' ? 't' : 'm';

  const feet = FEET_INCH.exec(text);
  if (feet) {
    if (targetUnit !== 'm') return null;
    const ft = Number(feet[1]);
    const inch = feet[2] ? Number(feet[2]) : 0;
    return { value: round3(ft * 0.3048 + inch * 0.0254), unit: 'm', raw: raw.trim() };
  }

  const m = NUMBER_UNIT.exec(text);
  if (!m) return null;
  const num = Number(m[1].replace(',', '.'));
  if (!Number.isFinite(num) || num <= 0) return null;
  const unit = m[2];

  if (targetUnit === 'm') {
    if (unit === '' || unit === 'm') return { value: round3(num), unit: 'm', raw: raw.trim() };
    if (unit === 'cm') return { value: round3(num / 100), unit: 'm', raw: raw.trim() };
    if (unit === 'ft') return { value: round3(num * 0.3048), unit: 'm', raw: raw.trim() };
    return null;
  }
  if (unit === '' || unit === 't') return { value: round3(num), unit: 't', raw: raw.trim() };
  if (unit === 'kg') return { value: round3(num / 1000), unit: 't', raw: raw.trim() };
  if (unit === 'lbs') return { value: round3((num * 0.45359237) / 1000), unit: 't', raw: raw.trim() };
  return null;
}

function round3(n: number): number {
  return Math.round(n * 1000) / 1000;
}

/** True when two closed bboxes overlap or touch. */
export function bboxesIntersect(a: Bbox, b: Bbox): boolean {
  return a[0] <= b[2] && b[0] <= a[2] && a[1] <= b[3] && b[1] <= a[3];
}

/**
 * Grow a bbox by `marginDeg` on every side.
 *
 * Used to widen a case's `forbidden_bbox` before searching: the box is drawn
 * around where the route must not GO, while the tagged way may extend a
 * little beyond it, and the case coordinates themselves are approximate. A
 * wider search surfaces more candidates for a human to choose from — it never
 * loosens an assertion, because the assertion still runs against the original
 * `forbidden_bbox`.
 */
export function expandBbox(bbox: Bbox, marginDeg: number): Bbox {
  if (!Number.isFinite(marginDeg) || marginDeg < 0) {
    throw new Error(`expandBbox: marginDeg must be >= 0 (got ${marginDeg})`);
  }
  return [bbox[0] - marginDeg, bbox[1] - marginDeg, bbox[2] + marginDeg, bbox[3] + marginDeg];
}

/** Bounding box of a GeoJSON coordinate list (any nesting depth). */
export function bboxOfCoordinates(coords: unknown): Bbox | null {
  let minLon = Infinity;
  let minLat = Infinity;
  let maxLon = -Infinity;
  let maxLat = -Infinity;

  const walk = (node: unknown): void => {
    if (!Array.isArray(node)) return;
    if (node.length >= 2 && typeof node[0] === 'number' && typeof node[1] === 'number') {
      const [lon, lat] = node as [number, number];
      if (lon < minLon) minLon = lon;
      if (lat < minLat) minLat = lat;
      if (lon > maxLon) maxLon = lon;
      if (lat > maxLat) maxLat = lat;
      return;
    }
    for (const child of node) walk(child);
  };
  walk(coords);

  if (!Number.isFinite(minLon) || !Number.isFinite(minLat)) return null;
  return [minLon, minLat, maxLon, maxLat];
}

/**
 * Parse one line of `osmium export -f geojsonseq` output into a candidate.
 *
 * Tolerates the id forms osmium emits across versions/flags (`@id` as a
 * number, as `"w123"`, or as `"way/123"`, plus a top-level `id`). Returns
 * `null` for anything that is not a way with a usable geometry — a candidate
 * we cannot name by way-id is useless as provenance.
 */
export function parseGeoJsonSeqLine(line: string): OsmWayCandidate | null {
  // RFC 8142 GeoJSONSeq records may be prefixed with an ASCII record separator
  // (U+001E), which `String.trim()` does NOT strip -- remove it explicitly or
  // every single line would fail to parse.
  // Done with a charCode comparison rather than a regex because a literal
  // control character inside a RegExp trips eslint's `no-control-regex`
  // (and rightly so: it is invisible in a diff).
  const body = line.charCodeAt(0) === RECORD_SEPARATOR ? line.slice(1) : line;
  const trimmed = body.trim();
  if (trimmed.length === 0) return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    return null;
  }
  if (typeof parsed !== 'object' || parsed === null) return null;
  const feature = parsed as { properties?: unknown; geometry?: unknown; id?: unknown };

  const props = (typeof feature.properties === 'object' && feature.properties !== null
    ? feature.properties
    : {}) as Record<string, unknown>;

  const wayId = extractWayId(props['@id'] ?? feature.id ?? props.id);
  if (wayId === null) return null;

  const geometry = feature.geometry as { coordinates?: unknown } | undefined;
  const bbox = bboxOfCoordinates(geometry?.coordinates);
  if (!bbox) return null;

  const tags: Record<string, string> = {};
  for (const [key, value] of Object.entries(props)) {
    if (key.startsWith('@')) continue;
    if (typeof value === 'string') tags[key] = value;
    else if (typeof value === 'number' || typeof value === 'boolean') tags[key] = String(value);
  }

  return { osm_way_id: wayId, tags, bbox };
}

function extractWayId(raw: unknown): number | null {
  if (typeof raw === 'number' && Number.isInteger(raw) && raw > 0) return raw;
  if (typeof raw !== 'string') return null;
  const m = /^(?:w|way\/|way)?(\d+)$/i.exec(raw.trim());
  if (!m) return null;
  const n = Number(m[1]);
  return Number.isInteger(n) && n > 0 ? n : null;
}

// --- Matching a candidate set against the curated cases ---------------------

export interface CandidateMatch {
  candidate: OsmWayCandidate;
  /** The tag key that produced `parsed` (e.g. `maxheight:physical`). */
  tagKey: string;
  parsed: ParsedTagValue;
}

export type CaseVerdict =
  | 'confirmed'
  | 'value_mismatch'
  | 'ambiguous'
  | 'no_candidates'
  | 'no_parsable_value';

export interface CaseProvenanceReport {
  caseId: string;
  kind: RestrictionCase['restriction']['kind'];
  /** The value the fixture currently claims. */
  declaredValue: number;
  /** The most restrictive (= actually binding) candidate found, if any. */
  binding: CandidateMatch | null;
  matches: CandidateMatch[];
  verdict: CaseVerdict;
  /** German-free, log-oriented explanation of the verdict. */
  note: string;
  /**
   * The `restriction` object to paste into `golden-routes.json` — present
   * ONLY when a binding candidate with a parsable value was found. There is
   * deliberately no "suggested" block for the other verdicts: a block without
   * a real way-id is exactly the fabrication this whole module exists to
   * prevent.
   */
  suggestedBlock: RestrictionCase['restriction'] | null;
}

/** Every DE restriction case, in fixture order. */
export function restrictionCases(cases: readonly GoldenCase[], region?: string): RestrictionCase[] {
  return cases.filter(
    (c): c is RestrictionCase => c.type === 'restriction' && (region === undefined || c.region === region),
  );
}

/**
 * Find, for one case, every candidate way that (a) overlaps the (optionally
 * widened) `forbidden_bbox` and (b) carries a parsable tag of the case's kind.
 *
 * The BINDING candidate is the one with the LOWEST value — that is the one
 * that actually stops the large profile, and therefore the one whose way-id
 * belongs in the fixture. Picking the first match instead would silently
 * document a weaker restriction than the route really faces.
 */
export function reportForCase(
  c: RestrictionCase,
  candidates: readonly OsmWayCandidate[],
  options: { marginDeg?: number; valueToleranceM?: number; sourceLabel?: string } = {},
): CaseProvenanceReport {
  const marginDeg = options.marginDeg ?? 0.002; // ~200 m
  const tolerance = options.valueToleranceM ?? 0.051;
  const searchBox = expandBbox(c.forbidden_bbox, marginDeg);
  const keys = TAG_KEYS[c.restriction.kind];

  const matches: CandidateMatch[] = [];
  let sawTagButUnparsable = false;

  for (const candidate of candidates) {
    if (!bboxesIntersect(candidate.bbox, searchBox)) continue;
    for (const tagKey of keys) {
      const raw = candidate.tags[tagKey];
      if (raw === undefined) continue;
      const parsed = parseTagValue(raw, c.restriction.kind);
      if (parsed === null) {
        sawTagButUnparsable = true;
        continue;
      }
      matches.push({ candidate, tagKey, parsed });
      break; // highest-priority key wins for a given way
    }
  }

  matches.sort((a, b) => a.parsed.value - b.parsed.value || a.candidate.osm_way_id - b.candidate.osm_way_id);
  const binding = matches[0] ?? null;

  let verdict: CaseVerdict;
  let note: string;
  if (binding === null) {
    verdict = sawTagButUnparsable ? 'no_parsable_value' : 'no_candidates';
    note =
      verdict === 'no_parsable_value'
        ? `A way in the box carries a ${c.restriction.kind} tag, but none of them has a numeric value ` +
          `(e.g. "default"/"none"). This case cannot be verified here — replace it via 'discover'.`
        : `No way inside the search box carries a ${c.restriction.kind} tag in this PBF. ` +
          `The case as written cannot pass — replace it with a real candidate from 'discover ${c.restriction.kind}'.`;
  } else if (Math.abs(binding.parsed.value - c.restriction.value) > tolerance) {
    verdict = 'value_mismatch';
    note =
      `The binding tag is ${binding.tagKey}=${binding.parsed.raw} (${binding.parsed.value} ${binding.parsed.unit}) ` +
      `on way ${binding.candidate.osm_way_id}, but the fixture claims ${c.restriction.value} ${c.restriction.unit}. ` +
      `Adopt the OBSERVED value (and re-check that small/large profiles still straddle it).`;
  } else if (matches.length > 1 && Math.abs(matches[1].parsed.value - binding.parsed.value) <= tolerance) {
    verdict = 'ambiguous';
    note =
      `${matches.length} ways in the box carry an equally binding ${c.restriction.kind}. ` +
      `Way ${binding.candidate.osm_way_id} is proposed (lowest id among the lowest values); ` +
      `narrow forbidden_bbox to the specific structure if that is not the intended one.`;
  } else {
    verdict = 'confirmed';
    note =
      `Binding ${binding.tagKey}=${binding.parsed.raw} on way ${binding.candidate.osm_way_id} ` +
      `matches the fixture value. Paste 'suggestedBlock' and flip unverified:false ` +
      `AFTER the routing assertions of this case also went green.`;
  }

  const suggestedBlock =
    binding === null
      ? null
      : {
          kind: c.restriction.kind,
          value: binding.parsed.value,
          unit: c.restriction.unit,
          osm_way_id: binding.candidate.osm_way_id,
          source: `${options.sourceLabel ?? 'OSM PBF'}: way ${binding.candidate.osm_way_id}, tag ${binding.tagKey}=${binding.parsed.raw} (read from the same extract the Valhalla graph was built from)`,
        };

  return {
    caseId: c.id,
    kind: c.restriction.kind,
    declaredValue: c.restriction.value,
    binding,
    matches,
    verdict,
    note,
    suggestedBlock,
  };
}

// --- Profile plausibility (checkable with NO OSM data at all) ---------------

/**
 * The dimension of a profile that the given restriction kind acts on.
 * `maxheight` → `height_m`, `maxweight` → `weight_t`, `maxwidth` → `width_m`.
 */
export function profileDimension(
  profile: RestrictionCase['small_profile'],
  kind: RestrictionCase['restriction']['kind'],
): number {
  switch (kind) {
    case 'maxheight':
      return profile.height_m;
    case 'maxweight':
      return profile.weight_t;
    case 'maxwidth':
      return profile.width_m;
  }
}

export interface ProfilePlausibility {
  ok: boolean;
  smallValue: number;
  largeValue: number;
  problems: string[];
}

/**
 * The E03-T5 "both directions" rule, checked at the PROFILE level: the small
 * profile must fit under/through the declared restriction and the large one
 * must not.
 *
 * Unlike everything else in this file, this needs no OSM data whatsoever — it
 * is pure fixture arithmetic — so it can and does run as a hard assertion in
 * every golden-routes invocation, including the per-PR gate. It catches the
 * silent-vacuity bug the routing assertions cannot: a "width" case whose large
 * profile is 2.4 m wide against a 2.5 m limit would pass its
 * `large must not enter the box` assertion for the trivial reason that the
 * vehicle fits, testing nothing at all.
 */
export function checkProfilePlausibility(c: RestrictionCase): ProfilePlausibility {
  const kind = c.restriction.kind;
  const smallValue = profileDimension(c.small_profile, kind);
  const largeValue = profileDimension(c.large_profile, kind);
  const limit = c.restriction.value;
  const problems: string[] = [];

  if (!(smallValue < limit)) {
    problems.push(
      `small_profile ${kind === 'maxweight' ? 'weight' : 'dimension'} ${smallValue} is not below the ` +
        `${kind} limit ${limit} — the small profile could be blocked too, making the ` +
        `"small must traverse the box" assertion impossible to satisfy for the wrong reason`,
    );
  }
  if (!(largeValue > limit)) {
    problems.push(
      `large_profile ${kind === 'maxweight' ? 'weight' : 'dimension'} ${largeValue} does not exceed the ` +
        `${kind} limit ${limit} — the large profile fits, so "large must not enter the box" would ` +
        `pass vacuously and test nothing`,
    );
  }
  if (!(largeValue > smallValue)) {
    problems.push(`large_profile (${largeValue}) must exceed small_profile (${smallValue}) in the tested dimension`);
  }

  return { ok: problems.length === 0, smallValue, largeValue, problems };
}

// --- Discover mode ----------------------------------------------------------

export interface DiscoveredRestriction {
  osm_way_id: number;
  kind: RestrictionCase['restriction']['kind'];
  value: number;
  unit: 'm' | 't';
  raw: string;
  tagKey: string;
  name: string | null;
  bbox: Bbox;
}

/**
 * Rank real, currently-tagged restrictions in the extract so an unusable
 * curated case can be REPLACED by an evidenced one instead of being guessed
 * into shape.
 *
 * Ranking = most binding first (lowest limit), because those are the ones a
 * 3.2 m / 3.5 t camper actually has to be routed around, and they are also
 * the ones where a broken profile→costing mapping does the most damage.
 * `minValue` filters out obvious data noise (a 0.5 m "maxheight" on a
 * barrier way is not a road restriction a motorhome case should be built on).
 */
export function discover(
  candidates: readonly OsmWayCandidate[],
  kind: RestrictionCase['restriction']['kind'],
  options: { limit?: number; minValue?: number; maxValue?: number } = {},
): DiscoveredRestriction[] {
  const limit = options.limit ?? 25;
  const minValue = options.minValue ?? (kind === 'maxweight' ? 2 : 1.5);
  const maxValue = options.maxValue ?? (kind === 'maxweight' ? 16 : 4.5);
  const keys = TAG_KEYS[kind];
  const found: DiscoveredRestriction[] = [];

  for (const candidate of candidates) {
    for (const tagKey of keys) {
      const raw = candidate.tags[tagKey];
      if (raw === undefined) continue;
      const parsed = parseTagValue(raw, kind);
      if (parsed === null) continue;
      if (parsed.value < minValue || parsed.value > maxValue) break;
      found.push({
        osm_way_id: candidate.osm_way_id,
        kind,
        value: parsed.value,
        unit: parsed.unit,
        raw: parsed.raw,
        tagKey,
        name: candidate.tags.name ?? null,
        bbox: candidate.bbox,
      });
      break;
    }
  }

  found.sort((a, b) => a.value - b.value || a.osm_way_id - b.osm_way_id);
  return found.slice(0, limit);
}
