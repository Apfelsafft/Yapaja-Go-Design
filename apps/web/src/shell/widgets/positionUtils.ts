/**
 * Shared helper for widgets that need "the current position, whichever
 * source is freshest" (E07-T1): a widget subscribing to both `pos/update`
 * (real fixes) and `pos/extrapolated` (dead-reckoning, W-01) gets each in
 * its OWN `data` key (the shared store keys strictly by exact topic, see
 * `wsStore.ts`) -- this picks whichever payload's own `ts` is more recent,
 * mirroring `positionStore.ts`'s `setRealPosition`/`setExtrapolatedPosition`
 * "whichever arrived last wins" behaviour without needing a second store.
 */

import type { Position } from '@yapaja/shared';

export function latestPosition(data: Readonly<Record<string, unknown>>): Position | null {
  const update = data['pos/update'] as Position | undefined;
  const extrapolated = data['pos/extrapolated'] as Position | undefined;
  if (!update && !extrapolated) return null;
  if (!update) return extrapolated as Position;
  if (!extrapolated) return update;
  return new Date(extrapolated.ts).getTime() >= new Date(update.ts).getTime() ? extrapolated : update;
}
