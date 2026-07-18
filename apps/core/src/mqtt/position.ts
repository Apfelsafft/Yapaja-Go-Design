/**
 * `yapaja/position` extrapolated-fix filter (E08-T1, E02-T5 stub / W-01).
 *
 * docs/03 §4: dead-reckoned (`extrapolated: true`) positions must NEVER be
 * published as `yapaja/position` -- HA/MQTT consumers should only ever see
 * genuine GPS fixes there. The bridge structurally only subscribes to
 * `pos/update` (never `pos/extrapolated`, see `bridge.ts`), so this guard is
 * unreachable in normal operation; it exists as an independently testable
 * invariant and defense-in-depth against a future subscribe mistake.
 */
import type { Position } from '@yapaja/shared';
import type { ExtrapolatedPositionPayload } from '../bus/index.js';

export function isRealPosition(pos: Position | ExtrapolatedPositionPayload): pos is Position {
  return !('extrapolated' in pos && (pos as ExtrapolatedPositionPayload).extrapolated === true);
}
