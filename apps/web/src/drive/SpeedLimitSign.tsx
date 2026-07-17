/**
 * Speed-limit sign (E04-T3, docs/06 §5): round EU-style sign showing
 * `speed_limit_kmh`. Hidden entirely when the limit is unknown (`null`) --
 * the plausibility invariant is "never render 0", so this component simply
 * never renders anything at all for `null` rather than a placeholder/dash.
 */

import React from 'react';
import type { NavState } from '@yapaja/shared';
import { useNavState, useNavStore } from './navStore.js';
import { isDriveActive } from './ManeuverPanel.js';

export interface SpeedLimitSignProps {
  /** Explicit `NavState` (E07-T1 widget reuse -- see
   *  `ManeuverPanel.tsx`'s identical `ManeuverPanelProps.navState` doc
   *  comment). Omit to use `useNavState()` as before. */
  navState?: NavState | null;
  /** Explicit drive-gate override, see `ManeuverPanelProps.driveGateOpen`. */
  driveGateOpen?: boolean;
}

export default function SpeedLimitSign(props: SpeedLimitSignProps = {}): React.ReactElement | null {
  const hookNavState = useNavState();
  // W-19 (E04-T5): see `ManeuverPanel.tsx`'s identical gate.
  const hookDriveGateOpen = useNavStore((state) => state.resumeAcknowledged);

  const navState = props.navState !== undefined ? props.navState : hookNavState;
  const driveGateOpen = props.driveGateOpen !== undefined ? props.driveGateOpen : hookDriveGateOpen;

  if (!navState || !driveGateOpen || !isDriveActive(navState.status)) return null;
  const kmh = navState.speed_limit_kmh;
  if (kmh === null) return null;

  return (
    <div
      data-testid="speed-limit-sign"
      className="absolute top-3 right-3 z-20 flex items-center justify-center w-16 h-16 rounded-full bg-white border-4 border-red-600 shadow-lg"
    >
      <span data-testid="speed-limit-value" className="text-2xl font-extrabold text-slate-900 tabular-nums">
        {kmh}
      </span>
    </div>
  );
}
