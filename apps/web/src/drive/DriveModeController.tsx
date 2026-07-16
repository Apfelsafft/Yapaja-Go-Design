/**
 * Drive-mode camera controller (E04-T5): switches the map to `3d-course` +
 * enables follow-me the moment a drive session becomes active
 * (navigating/off_route/paused, gated on the W-19 resume prompt being
 * acknowledged -- see `navStore.ts#useDriveGateOpen`), and restores whatever
 * view mode was active BEFORE driving started once the session ends
 * (stop/arrival) -- "Stop -> Explore-Modus" (docs/03 §2 E04-T5). Follow-me is
 * simply turned off again; the route itself is untouched (it lives in the
 * routing store, not here) so it stays visible in explore mode, per spec.
 *
 * Renders nothing -- pure side-effect component, mounted once in
 * `DriveOverlay.tsx` (same lifecycle as the WS connection).
 */

import { useEffect, useRef } from 'react';
import { isDriveActive } from './ManeuverPanel.js';
import { useNavStore } from './navStore.js';
import { useViewModeStore, type ViewMode } from '../map/viewMode.js';
import { useFollowMeStore } from '../map/followMe.js';

export default function DriveModeController(): null {
  const status = useNavStore((state) => state.navState?.status ?? null);
  const driveGateOpen = useNavStore((state) => state.resumeAcknowledged);
  const inDriveMode = useRef(false);
  const priorViewMode = useRef<ViewMode | null>(null);

  useEffect(() => {
    const shouldBeInDriveMode = driveGateOpen && isDriveActive(status);

    if (shouldBeInDriveMode && !inDriveMode.current) {
      priorViewMode.current = useViewModeStore.getState().mode;
      useViewModeStore.getState().setMode('3d-course');
      useFollowMeStore.getState().setFollowing(true);
      inDriveMode.current = true;
    } else if (!shouldBeInDriveMode && inDriveMode.current) {
      useFollowMeStore.getState().setFollowing(false);
      useViewModeStore.getState().setMode(priorViewMode.current ?? '2d-north');
      priorViewMode.current = null;
      inDriveMode.current = false;
    }
  }, [status, driveGateOpen]);

  return null;
}
