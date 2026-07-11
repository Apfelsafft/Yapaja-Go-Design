/**
 * EXPLICIT Valhalla maneuver-type -> `ManeuverType` mapping table.
 *
 * Valhalla returns `maneuver.type` as an INTEGER enum
 * (`valhalla::DirectionsLeg::Maneuver::Type`). Our app-internal `ManeuverType`
 * (`@yapaja/shared`) is a small, coarse vocabulary used to pick the turn icon:
 *   'straight' | 'continue' | 'turn_left' | 'turn_right'
 *   | 'roundabout_enter' | 'roundabout_exit' | (any other string).
 *
 * SOURCE OF TRUTH: the canonical Valhalla enum below (from the Valhalla source
 * `proto/directions.proto`), NOT the illustrative numbers in the task brief.
 * See KLÄRUNGSBEDARF in the task report: the brief's examples ("15/16 ->
 * turn_left/right") do not match the real enum (15 = kLeft, 16 = kSlightLeft),
 * and mapping to the brief's literal numbers would emit WRONG turn
 * instructions. We therefore map against the real enum and pin every entry
 * with its Valhalla symbol so the table is auditable.
 *
 * Design rules for collapsing into the coarse vocabulary:
 *  - slight/sharp left/right collapse into 'turn_left' / 'turn_right' (icon
 *    granularity only; direction is preserved).
 *  - ramp/exit/stay left/right map to the matching turn side.
 *  - U-turns are kept DISTINCT ('uturn_left' / 'uturn_right') -- never
 *    collapsed to a plain turn, because telling a driver "turn left" when they
 *    must make a U-turn is a real navigation-safety defect.
 *  - depart/arrive/merge/becomes without a turn -> 'straight' / 'continue'.
 *  - anything not in the table (future/unknown enum value) -> the raw integer
 *    as a string (pass-through), so the pipeline never throws on an
 *    unrecognised type.
 */

import type { ManeuverType } from '@yapaja/shared';

export const VALHALLA_MANEUVER_TYPE: Readonly<Record<number, ManeuverType>> = {
  0: 'continue', // kNone
  1: 'straight', // kStart (depart)
  2: 'turn_right', // kStartRight (depart to the right)
  3: 'turn_left', // kStartLeft (depart to the left)
  4: 'straight', // kDestination (arrive straight ahead)
  5: 'turn_right', // kDestinationRight (arrive on the right)
  6: 'turn_left', // kDestinationLeft (arrive on the left)
  7: 'continue', // kBecomes (road name changes)
  8: 'continue', // kContinue
  9: 'turn_right', // kSlightRight
  10: 'turn_right', // kRight
  11: 'turn_right', // kSharpRight
  12: 'uturn_right', // kUturnRight (kept distinct on purpose)
  13: 'uturn_left', // kUturnLeft (kept distinct on purpose)
  14: 'turn_left', // kSharpLeft
  15: 'turn_left', // kLeft
  16: 'turn_left', // kSlightLeft
  17: 'straight', // kRampStraight
  18: 'turn_right', // kRampRight
  19: 'turn_left', // kRampLeft
  20: 'turn_right', // kExitRight
  21: 'turn_left', // kExitLeft
  22: 'straight', // kStayStraight
  23: 'turn_right', // kStayRight
  24: 'turn_left', // kStayLeft
  25: 'continue', // kMerge
  26: 'roundabout_enter', // kRoundaboutEnter
  27: 'roundabout_exit', // kRoundaboutExit
  28: 'continue', // kFerryEnter
  29: 'continue', // kFerryExit
} as const;

/**
 * Map a Valhalla integer maneuver type to a `ManeuverType`. Unknown values are
 * passed through as their decimal string (`String(type)`) rather than guessed,
 * so a route is never silently mislabelled.
 */
export function mapManeuverType(valhallaType: number): ManeuverType {
  const mapped = VALHALLA_MANEUVER_TYPE[valhallaType];
  return mapped ?? String(valhallaType);
}
