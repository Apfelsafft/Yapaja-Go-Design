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
import { mapController } from '../state/mapStore.js';
import { drivePaddingTop } from '../map/drivePadding.js';

export default function DriveModeController(): null {
  const status = useNavStore((state) => state.navState?.status ?? null);
  const driveGateOpen = useNavStore((state) => state.resumeAcknowledged);
  const inDriveMode = useRef(false);
  const priorViewMode = useRef<ViewMode | null>(null);

  useEffect(() => {
    const shouldBeInDriveMode = driveGateOpen && isDriveActive(status);

    if (shouldBeInDriveMode && !inDriveMode.current) {
      priorViewMode.current = useViewModeStore.getState().mode;
      // ─── ZUERST DIE VERSCHIEBUNG, DANN DER MODUS ──────────────────────────
      // Das Fahrzeug sitzt waehrend der Fahrt im unteren Viertel, damit das
      // Bild nach VORNE schaut -- begruendet und nachgerechnet in
      // `map/drivePadding.ts`. Hier und nicht im Kartencode, weil genau hier
      // schon steht, wann eine Fahrt beginnt und endet.
      //
      // Die REIHENFOLGE ist kein Geschmack: `setPadding` bricht eine laufende
      // Kamerafahrt ab. Stand es hinter `setMode`, verschluckte es genau die
      // Bewegung, mit der `3d-course` die Neigung anlegt -- die Karte blieb
      // flach. Gefunden hat das `nav-control.spec.ts` („pitch > 50", gemessen
      // 0). Wer das hier wieder tauscht, nimmt die 3D-Ansicht mit.
      mapController.setTopPadding(drivePaddingTop(mapController.getHeightPx()));
      useViewModeStore.getState().setMode('3d-course');
      useFollowMeStore.getState().setFollowing(true);
      inDriveMode.current = true;
    } else if (!shouldBeInDriveMode && inDriveMode.current) {
      useFollowMeStore.getState().setFollowing(false);
      // Ausserhalb der Fahrt gehoert die Position wieder in die Mitte: dort
      // geht es ums Umsehen, nicht ums Vorausschauen. Auch hier zuerst, aus
      // demselben Grund wie oben.
      mapController.setTopPadding(null);
      useViewModeStore.getState().setMode(priorViewMode.current ?? '2d-north');
      priorViewMode.current = null;
      inDriveMode.current = false;
    }
  }, [status, driveGateOpen]);

  return null;
}
