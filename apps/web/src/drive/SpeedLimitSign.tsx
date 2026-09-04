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

/**
 * Ab wie viel km/h ueber dem Limit das Schild rot wird.
 *
 * Die GPS-Geschwindigkeit schwankt um einige km/h. Ohne Toleranz flackerte
 * das Schild bei konstanter Fahrt am Limit -- und ein Warnsignal, das
 * flackert, wird weggesehen.
 */
export const SPEEDING_TOLERANCE_KMH = 3;

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

  // ─── ZU SCHNELL: DAS SCHILD WIRD ROT ──────────────────────────────────────
  // Gewuenscht als Ueberschreitungswarnung: „dass bspw die Anzeige im
  // aktuellen Tempolimit, als entsprechendes Verkehrsschild, rot wird."
  //
  // Bewusst mit Toleranz: GPS-Geschwindigkeit schwankt, und ein Schild, das
  // bei 51 km/h in einer 50er-Zone flackert, wird ignoriert -- und ein
  // ignoriertes Warnsignal ist schlimmer als keines.
  const speed = navState.speed_kmh;
  const speeding = speed !== null && speed > kmh + SPEEDING_TOLERANCE_KMH;

  return (
    <div
      data-testid="speed-limit-sign"
      data-speeding={speeding ? 'true' : 'false'}
      className={`absolute top-3 right-3 z-20 flex items-center justify-center w-16 h-16 rounded-full border-4 shadow-lg ${
        speeding ? 'bg-red-600 border-red-700' : 'bg-white border-red-600'
      }`}
    >
      <span
        data-testid="speed-limit-value"
        className={`text-2xl font-extrabold tabular-nums ${
          speeding ? 'text-white' : 'text-slate-900'
        }`}
      >
        {kmh}
      </span>
    </div>
  );
}
