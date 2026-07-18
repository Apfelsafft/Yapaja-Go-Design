/**
 * LHD/RHD FAB-mirroring setting (E07-T4, docs/06 §4: "Primäraktionen in
 * Daumenreichweite (unten/rechts, spiegelbar für LHD/RHD-Montage)"). Pure
 * type/validation logic -- mirrors `theme/resolveTheme.ts`'s "no DOM"
 * module boundary.
 *
 * `'rhd'` (the default) keeps the app's pre-existing, hard-coded
 * bottom-RIGHT FAB placement (Drive controls, TTS toggle) unchanged -- so a
 * fresh install/reload with no explicit choice made renders byte-identical
 * to before this setting existed. `'lhd'` mirrors those FABs to the
 * bottom-LEFT (e.g. a tablet mounted on the side closer to the driver in a
 * left-hand-drive vehicle, where the driver's free hand naturally falls on
 * the left).
 */

export type Handedness = 'lhd' | 'rhd';

export const DEFAULT_HANDEDNESS: Handedness = 'rhd';

const VALID_HANDEDNESS: readonly Handedness[] = ['lhd', 'rhd'];

export function isHandedness(value: unknown): value is Handedness {
  return typeof value === 'string' && (VALID_HANDEDNESS as readonly string[]).includes(value);
}

/** The Tailwind side-anchor class for a handedness -- `'lhd'` anchors to the
 *  left edge, `'rhd'` (default) to the right, mirroring the FAB cluster. */
export function sideClassFor(handedness: Handedness): 'left-3' | 'right-3' {
  return handedness === 'lhd' ? 'left-3' : 'right-3';
}

/** The flex-alignment class matching `sideClassFor` -- a `flex-col` stack
 *  anchored to the left edge should align its children to the start, not
 *  the end (and vice versa), so multi-line content doesn't visually drift
 *  toward the wrong edge. */
export function itemsAlignClassFor(handedness: Handedness): 'items-start' | 'items-end' {
  return handedness === 'lhd' ? 'items-start' : 'items-end';
}
