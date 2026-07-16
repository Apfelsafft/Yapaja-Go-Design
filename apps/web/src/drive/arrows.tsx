/**
 * Maneuver arrow icon set (E04-T3, docs/06 §5): one SVG sprite covering every
 * `ManeuverType` the pipeline can actually produce
 * (`apps/core/src/routing/maneuverMapping.ts`'s coarse vocabulary) plus a
 * sensible default for the open string tail (an unmapped Valhalla enum
 * value, or anything else unforeseen) -- "unknown/other types -> a sensible
 * default like continue" per the task spec.
 *
 * `resolveArrowKey` is exported separately from the component so the
 * ManeuverType -> icon mapping is unit-testable as a plain table (docs/06 §5
 * plausibility rule: "Pfeil-Icon stimmt mit ManeuverType überein").
 */

import React from 'react';
import type { ManeuverType } from '@yapaja/shared';

export type ArrowKey =
  | 'turn_left'
  | 'turn_right'
  | 'uturn_left'
  | 'uturn_right'
  | 'roundabout_enter'
  | 'roundabout_exit'
  | 'straight';

/** Every `ArrowKey` this sprite actually draws; used by the mapping-table test to assert full coverage. */
export const ARROW_KEYS: readonly ArrowKey[] = [
  'straight',
  'turn_left',
  'turn_right',
  'uturn_left',
  'uturn_right',
  'roundabout_enter',
  'roundabout_exit',
];

/** Default arrow for any `ManeuverType` not explicitly mapped below (open Valhalla enum tail). */
const DEFAULT_ARROW_KEY: ArrowKey = 'straight';

const MANEUVER_TO_ARROW: Readonly<Record<string, ArrowKey>> = {
  turn_left: 'turn_left',
  turn_right: 'turn_right',
  uturn_left: 'uturn_left',
  uturn_right: 'uturn_right',
  roundabout_enter: 'roundabout_enter',
  roundabout_exit: 'roundabout_exit',
  straight: 'straight',
  continue: 'straight',
};

/** Resolve any `ManeuverType` (including the open/unmapped string tail) to a drawable {@link ArrowKey}. */
export function resolveArrowKey(type: ManeuverType): ArrowKey {
  return MANEUVER_TO_ARROW[type] ?? DEFAULT_ARROW_KEY;
}

/** One `<symbol>` per arrow, all sharing a 0..24 viewBox so they can be `<use>`d at any size. */
export function ManeuverArrowSprite(): React.ReactElement {
  return (
    <svg width="0" height="0" style={{ position: 'absolute' }} aria-hidden="true" focusable="false">
      <defs>
        <symbol id="arrow-straight" viewBox="0 0 24 24">
          <path d="M12 2 L12 20 M6 8 L12 2 L18 8" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
        </symbol>
        <symbol id="arrow-turn_left" viewBox="0 0 24 24">
          <path d="M20 20 V12 C20 8 17 5 13 5 H6 M6 5 L11 1 M6 5 L11 9" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
        </symbol>
        <symbol id="arrow-turn_right" viewBox="0 0 24 24">
          <path d="M4 20 V12 C4 8 7 5 11 5 H18 M18 5 L13 1 M18 5 L13 9" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
        </symbol>
        <symbol id="arrow-uturn_left" viewBox="0 0 24 24">
          <path d="M18 20 V10 C18 6 15 4 11 4 C7 4 5 6 5 9 M5 9 L1 6 M5 9 L9 7" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
        </symbol>
        <symbol id="arrow-uturn_right" viewBox="0 0 24 24">
          <path d="M6 20 V10 C6 6 9 4 13 4 C17 4 19 6 19 9 M19 9 L23 6 M19 9 L15 7" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
        </symbol>
        <symbol id="arrow-roundabout_enter" viewBox="0 0 24 24">
          <circle cx="12" cy="12" r="7" fill="none" stroke="currentColor" strokeWidth="2" />
          <path d="M12 2 V9 M8 5 L12 2 L16 5" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
        </symbol>
        <symbol id="arrow-roundabout_exit" viewBox="0 0 24 24">
          <circle cx="12" cy="12" r="7" fill="none" stroke="currentColor" strokeWidth="2" />
          <path d="M12 22 V15 M8 19 L12 22 L16 19" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
        </symbol>
      </defs>
    </svg>
  );
}

export interface ManeuverArrowProps {
  type: ManeuverType;
  className?: string;
  size?: number;
}

/** Renders the arrow matching `type` (falling back gracefully for unknown types). */
export function ManeuverArrow({ type, className, size = 40 }: ManeuverArrowProps): React.ReactElement {
  const key = resolveArrowKey(type);
  return (
    <svg
      className={className}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      data-testid="maneuver-arrow"
      data-arrow-key={key}
      role="img"
      aria-label={`Manöver: ${type}`}
    >
      <use href={`#arrow-${key}`} />
    </svg>
  );
}
