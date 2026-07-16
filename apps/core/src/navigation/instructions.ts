/**
 * Maneuver logic, announcement engine & speed limit (E04-T3, docs/06 §5,
 * docs/03 §3 `nav/instruction`, Wargame W-23).
 *
 * PURE (no clocks, no bus, no I/O) -- mirrors the `eta.ts` split: this module
 * owns the math/state-transition rules, `NavigationService` owns the wall
 * clock, the running {@link AnnouncementState}, and the actual
 * `bus.publish('nav/instruction', ...)` call.
 *
 * Three independent pieces:
 *  1. {@link findUpcomingManeuver} -- which maneuver is "next" given progress
 *     (the SAME rule `NavigationService.buildState()` uses for
 *     `next_maneuver`/`distance_to_maneuver_m`, extracted here so the
 *     announcement engine and `nav/state` never disagree on what "next" means).
 *  2. {@link tickAnnouncement} -- the speed-scaled threshold trigger + W-23
 *     "new displaces old" queue behaviour + double-fire protection, and
 *     {@link buildSayText} -- the natural-language sentence.
 *  3. {@link buildSpeedSegmentAnchors} / {@link findActiveSpeedLimitKmh} --
 *     progress -> active `SpeedSegment` -> `speed_limit_kmh` lookup.
 */

import type { Maneuver, ManeuverType, SpeedSegment } from '@yapaja/shared';
import type { ManeuverAnchor } from './eta.js';
import type { RouteGeometry } from './mapMatching.js';

// --- 1. Active maneuver -----------------------------------------------------

/**
 * The upcoming maneuver given `progressM` along the route: the first anchor
 * whose `progressM` is still ahead of the vehicle, or `null` past the last
 * one. `anchors` MUST be sorted ascending by `progressM` (as
 * `buildManeuverAnchors` returns them). Once `progressM` passes a maneuver's
 * anchor it is never returned again -- satisfies the "no announcement after
 * passing the maneuver" plausibility rule by construction.
 */
export function findUpcomingManeuver(
  anchors: readonly ManeuverAnchor[],
  progressM: number,
): ManeuverAnchor | null {
  return anchors.find((a) => a.progressM > progressM) ?? null;
}

// --- 2. Announcement engine --------------------------------------------------

/**
 * Base announce/display thresholds, metres, docs/06 §5 -- "2000 m (Autobahn),
 * 500 m, 200 m, „Jetzt"". Ordered far -> near; the last entry (0 m) is the
 * immediate ("Jetzt"/"Now") announcement. Indices are used as stable
 * identities for the double-fire-protection bookkeeping below, so this array
 * is append-only in practice (reordering would change what "already fired"
 * means for an in-flight navigation).
 */
export const BASE_ANNOUNCE_THRESHOLDS_M: readonly number[] = [2000, 500, 200, 0];

/** Index of the immediate ("Jetzt"/"Now") threshold within {@link BASE_ANNOUNCE_THRESHOLDS_M}. */
export const IMMEDIATE_THRESHOLD_INDEX = BASE_ANNOUNCE_THRESHOLDS_M.length - 1;

/** How many seconds of travel the speed-scaled floor guarantees as advance warning. */
export const THRESHOLD_SPEED_SCALE_S = 12;

/**
 * Speed-scaled threshold distance: `max(base, 12s * speed)` (docs/06 §5 /
 * task spec literally). At highway speed this pushes EVERY threshold further
 * out -- e.g. at 130 km/h (~36 m/s), 12s covers ~432 m, so even the 200 m and
 * "Jetzt" bases both scale up to ~432 m and can end up firing together (the
 * nearer of the two, see {@link tickAnnouncement}) instead of as two separate
 * announcements seconds apart -- exactly the "fewer, better-spaced
 * announcements at speed" behaviour real turn-by-turn nav apps have.
 * `speedMs` of `null`/`<=0` scales to 0 (no floor applied, base wins).
 */
export function scaledThresholdM(baseM: number, speedMs: number | null): number {
  const speed = speedMs != null && speedMs > 0 ? speedMs : 0;
  return Math.max(baseM, THRESHOLD_SPEED_SCALE_S * speed);
}

/** Per-navigation running state for the announcement engine; reset when navigation (re)starts. */
export interface AnnouncementState {
  /** Stable identity of the maneuver currently being tracked, or `null` (nothing active yet). */
  maneuverKey: string | null;
  /** Highest {@link BASE_ANNOUNCE_THRESHOLDS_M} index already announced for `maneuverKey`; -1 = none yet. */
  firedUpToIndex: number;
}

export function initialAnnouncementState(): AnnouncementState {
  return { maneuverKey: null, firedUpToIndex: -1 };
}

export interface AnnouncementTickInput {
  /** The currently upcoming maneuver, or `null` when there is none (idle/arrived/past the last maneuver). */
  maneuver: Maneuver | null;
  /**
   * Stable identity for `maneuver` (e.g. `${route.id}:${maneuver.index}`) --
   * NOT the same object reference every tick, so identity can't be done with
   * `===`. `null` iff `maneuver` is `null`.
   */
  maneuverKey: string | null;
  distanceToManeuverM: number | null;
  speedMs: number | null;
}

export interface AnnouncementFire {
  thresholdIndex: number;
  maneuver: Maneuver;
  /** Distance to the maneuver at the moment this threshold fired (unrounded). */
  distanceM: number;
  /** True iff `thresholdIndex === IMMEDIATE_THRESHOLD_INDEX` ("Jetzt"/"Now"). */
  immediate: boolean;
}

export interface AnnouncementTickResult {
  state: AnnouncementState;
  /** Non-null exactly when a NEW announcement should be published this tick. */
  fire: AnnouncementFire | null;
}

/**
 * One announcement-engine tick (docs/06 §5, Wargame W-23).
 *
 * Fires the DEEPEST (nearest) not-yet-fired threshold whose speed-scaled
 * distance the current `distanceToManeuverM` has reached -- if a tick's GPS
 * fix jumps past several thresholds at once (sparse fixes, a big speed
 * change), only ONE announcement fires (the most current one), never a
 * backlog of the skipped-over ones. That IS the W-23 "a new announcement
 * displaces a still-waiting old one" rule: there is no queue of pending
 * announcements to speak of, because a tick only ever considers "what's true
 * right now" and discards anything older.
 *
 * Double-fire protection: `firedUpToIndex` only ever increases for a given
 * `maneuverKey`, so (a) GPS jitter nudging distance back above an
 * already-fired threshold and then back down again never re-fires it, and
 * (b) once `maneuver`/`maneuverKey` changes (the vehicle passed the tracked
 * maneuver and a new one became "upcoming"), tracking resets for the NEW
 * maneuver -- the old one is never revisited (callers only ever pass the
 * CURRENT upcoming maneuver, see {@link findUpcomingManeuver}), so it can
 * never announce again either.
 */
export function tickAnnouncement(
  state: AnnouncementState,
  input: AnnouncementTickInput,
): AnnouncementTickResult {
  if (!input.maneuver || input.maneuverKey === null || input.distanceToManeuverM === null) {
    return { state: initialAnnouncementState(), fire: null };
  }

  const working: AnnouncementState =
    state.maneuverKey === input.maneuverKey
      ? state
      : { maneuverKey: input.maneuverKey, firedUpToIndex: -1 };

  let candidateIndex = -1;
  for (let i = 0; i < BASE_ANNOUNCE_THRESHOLDS_M.length; i++) {
    if (i <= working.firedUpToIndex) continue;
    const scaled = scaledThresholdM(BASE_ANNOUNCE_THRESHOLDS_M[i], input.speedMs);
    if (input.distanceToManeuverM <= scaled) candidateIndex = i;
  }

  if (candidateIndex === -1) {
    return { state: working, fire: null };
  }

  const newState: AnnouncementState = { maneuverKey: working.maneuverKey, firedUpToIndex: candidateIndex };
  return {
    state: newState,
    fire: {
      thresholdIndex: candidateIndex,
      maneuver: input.maneuver,
      distanceM: input.distanceToManeuverM,
      immediate: candidateIndex === IMMEDIATE_THRESHOLD_INDEX,
    },
  };
}

// --- 2b. say-text (natural-language German/English sentence) ----------------

export type SayLang = 'de' | 'en';

interface ManeuverPhrase {
  de: string;
  en: string;
  /** Whether "auf die <street>" / "onto <street>" reads naturally appended to this phrase. */
  appendsStreet: boolean;
}

/**
 * Coarse `ManeuverType` -> phrase table. Covers every value
 * `routing/maneuverMapping.ts#mapManeuverType` can actually produce
 * ('continue' | 'straight' | 'turn_left' | 'turn_right' | 'uturn_left' |
 * 'uturn_right' | 'roundabout_enter' | 'roundabout_exit') plus a fallback for
 * the open string tail of `ManeuverType` (an unmapped Valhalla enum value,
 * passed through as its raw integer string) -- the "handle the open set
 * gracefully" requirement: never throws, always produces a sensible sentence.
 */
const MANEUVER_PHRASES: Readonly<Record<string, ManeuverPhrase>> = {
  turn_left: { de: 'links abbiegen', en: 'turn left', appendsStreet: true },
  turn_right: { de: 'rechts abbiegen', en: 'turn right', appendsStreet: true },
  uturn_left: { de: 'wenden', en: 'make a U-turn', appendsStreet: false },
  uturn_right: { de: 'wenden', en: 'make a U-turn', appendsStreet: false },
  roundabout_enter: {
    de: 'in den Kreisverkehr einfahren',
    en: 'enter the roundabout',
    appendsStreet: false,
  },
  roundabout_exit: {
    de: 'den Kreisverkehr verlassen',
    en: 'exit the roundabout',
    appendsStreet: false,
  },
  straight: { de: 'geradeaus weiterfahren', en: 'continue straight', appendsStreet: true },
  continue: { de: 'der Straße folgen', en: 'continue on the road', appendsStreet: true },
};

/** Fallback for any `ManeuverType` not in {@link MANEUVER_PHRASES} (open Valhalla enum tail). */
const DEFAULT_PHRASE: ManeuverPhrase = MANEUVER_PHRASES.continue;

function phraseFor(type: ManeuverType): ManeuverPhrase {
  return MANEUVER_PHRASES[type] ?? DEFAULT_PHRASE;
}

/** Round a distance to 50 m steps (docs spec: "Zahlwort-Rundung 50er-Schritte"). Never negative. */
export function roundToStep(distanceM: number, stepM = 50): number {
  if (!Number.isFinite(distanceM) || distanceM <= 0) return 0;
  return Math.round(distanceM / stepM) * stepM;
}

function germanDistancePhrase(roundedM: number): string {
  if (roundedM >= 1000) {
    const km = Math.round((roundedM / 1000) * 10) / 10;
    const formatted = Number.isInteger(km) ? String(km) : km.toFixed(1).replace('.', ',');
    return `${formatted} Kilometer${km === 1 ? '' : 'n'}`;
  }
  return `${roundedM} Metern`;
}

function englishDistancePhrase(roundedM: number): string {
  if (roundedM >= 1000) {
    const km = Math.round((roundedM / 1000) * 10) / 10;
    return `${km} kilometer${km === 1 ? '' : 's'}`;
  }
  return `${roundedM} meters`;
}

export interface SayTextInput {
  maneuver: Pick<Maneuver, 'type' | 'street_names'>;
  /** Distance to the maneuver, metres (rounded to 50 m steps internally unless `immediate`). */
  distanceM: number;
  /** True for the "Jetzt"/"Now" (immediate) announcement -- skips the distance phrase entirely. */
  immediate?: boolean;
}

/**
 * Build the natural-language announcement sentence, e.g. (de) "In 300 Metern
 * links abbiegen auf die Bundesstraße 27" -- the docs/06 §5 canonical example.
 * PURE: no I/O, no locale/Intl dependency (deterministic across Node builds
 * without full ICU), so it's directly snapshot-testable.
 */
export function buildSayText(input: SayTextInput, lang: SayLang): string {
  const phrase = phraseFor(input.maneuver.type);
  const street = input.maneuver.street_names[0];
  const action = lang === 'de' ? phrase.de : phrase.en;
  const withStreet =
    phrase.appendsStreet && street
      ? lang === 'de'
        ? `${action} auf die ${street}`
        : `${action} onto ${street}`
      : action;

  if (input.immediate) {
    const now = lang === 'de' ? 'Jetzt' : 'Now';
    return `${now} ${withStreet}`;
  }

  const rounded = roundToStep(input.distanceM);
  const distancePhrase = lang === 'de' ? germanDistancePhrase(rounded) : englishDistancePhrase(rounded);
  return `In ${distancePhrase} ${withStreet}`;
}

// --- 3. Speed limit segment lookup ------------------------------------------

export interface SpeedSegmentAnchor {
  segment: SpeedSegment;
  /** Progress (m) at `segment.begin_shape_index`. */
  startM: number;
  /** Progress (m) at `segment.end_shape_index`. */
  endM: number;
}

/**
 * Anchor every `SpeedSegment` onto the route's cumulative-progress axis
 * (mirrors `eta.ts#buildManeuverAnchors`), sorted ascending by `startM`.
 * Segments with an out-of-range or inverted shape-index pair are dropped
 * defensively -- `Route.speed_limits` is untrusted upstream data (or, today,
 * simply empty -- `routing/mapResponse.ts` doesn't populate it yet), never
 * something to throw on.
 */
export function buildSpeedSegmentAnchors(
  speedLimits: readonly SpeedSegment[],
  geom: Pick<RouteGeometry, 'cumulative'>,
): SpeedSegmentAnchor[] {
  const anchors: SpeedSegmentAnchor[] = [];
  for (const segment of speedLimits) {
    const { begin_shape_index: beginIdx, end_shape_index: endIdx } = segment;
    if (
      beginIdx < 0 ||
      endIdx < 0 ||
      beginIdx >= geom.cumulative.length ||
      endIdx >= geom.cumulative.length
    ) {
      continue;
    }
    const startM = geom.cumulative[beginIdx];
    const endM = geom.cumulative[endIdx];
    if (endM < startM) continue;
    anchors.push({ segment, startM, endM });
  }
  anchors.sort((a, b) => a.startM - b.startM);
  return anchors;
}

/**
 * Active speed limit (km/h) at `progressM`, half-open per segment
 * (`[startM, endM)`) so two adjacent segments never both claim the exact
 * boundary point. Returns `null` when no segment covers `progressM` --
 * EITHER because `speedLimits`/`anchors` is empty (today's reality, see
 * `routing/mapResponse.ts`) or because of a genuine gap between segments.
 * Never fabricates `0` (docs/06 §5 plausibility invariant: unknown limit ⇒
 * hidden sign, never "0"); a segment whose own `kmh` is `null` ("unbekannt
 * für diesen Abschnitt") is passed through as `null` too, same rule.
 */
export function findActiveSpeedLimitKmh(
  anchors: readonly SpeedSegmentAnchor[],
  progressM: number,
): number | null {
  for (const anchor of anchors) {
    if (progressM >= anchor.startM && progressM < anchor.endM) {
      return anchor.segment.kmh;
    }
  }
  return null;
}
