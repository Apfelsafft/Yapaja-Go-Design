/**
 * Maneuver arrow icon mapping-table test (E04-T3 plausibility rule: "Pfeil-
 * Icon stimmt mit ManeuverType überein"). Covers every `ManeuverType` the
 * pipeline can actually produce (`apps/core/src/routing/maneuverMapping.ts`)
 * plus the open/unmapped fallback.
 */

import { describe, it, expect } from 'vitest';
import { resolveArrowKey, ARROW_KEYS } from './arrows.js';

describe('resolveArrowKey (maneuver -> arrow mapping table)', () => {
  it('maps every known ManeuverType to its matching arrow key', () => {
    expect(resolveArrowKey('turn_left')).toBe('turn_left');
    expect(resolveArrowKey('turn_right')).toBe('turn_right');
    expect(resolveArrowKey('uturn_left')).toBe('uturn_left');
    expect(resolveArrowKey('uturn_right')).toBe('uturn_right');
    expect(resolveArrowKey('roundabout_enter')).toBe('roundabout_enter');
    expect(resolveArrowKey('roundabout_exit')).toBe('roundabout_exit');
    expect(resolveArrowKey('straight')).toBe('straight');
  });

  it('maps "continue" to the straight-ahead arrow (no dedicated glyph needed)', () => {
    expect(resolveArrowKey('continue')).toBe('straight');
  });

  it('falls back to "straight" for an unmapped/unknown type (open Valhalla enum tail)', () => {
    expect(resolveArrowKey('42')).toBe('straight');
    expect(resolveArrowKey('some_future_valhalla_type')).toBe('straight');
  });

  it('every ARROW_KEYS entry is reachable via at least one ManeuverType', () => {
    const knownTypes = [
      'turn_left',
      'turn_right',
      'uturn_left',
      'uturn_right',
      'roundabout_enter',
      'roundabout_exit',
      'straight',
      'continue',
    ];
    const reached = new Set(knownTypes.map(resolveArrowKey));
    for (const key of ARROW_KEYS) {
      expect(reached.has(key)).toBe(true);
    }
  });
});
