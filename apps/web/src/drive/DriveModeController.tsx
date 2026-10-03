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

import { useEffect, useRef, useState } from 'react';
import { isDriveActive } from './ManeuverPanel.js';
import { useNavStore } from './navStore.js';
import { useViewModeStore, type ViewMode } from '../map/viewMode.js';
import { useFollowMeStore } from '../map/followMe.js';
import { mapController } from '../state/mapStore.js';
import { ankerFuer, ankerRaender } from '../map/kartenAnker.js';
import { useHandednessStore } from '../shell/handednessStore.js';
import { useAnordnungStore, type Modus } from '../shell/anordnung.js';
import { useMapStore } from '../state/mapStore.js';
import { usePositionStore } from '../position/positionStore.js';

/** Die Ränder für den Anker des Bildschirms (`map/kartenAnker.ts`). */
function raenderFuer(modus: Modus, einbau: 'lhd' | 'rhd') {
  const anker = ankerFuer(useAnordnungStore.getState().werte[modus], modus, einbau);
  return ankerRaender(mapController.getWidthPx(), mapController.getHeightPx(), anker);
}

export default function DriveModeController(): null {
  const status = useNavStore((state) => state.navState?.status ?? null);
  const driveGateOpen = useNavStore((state) => state.resumeAcknowledged);
  // Links- oder Rechtslenker: entscheidet, in welches untere Viertel das
  // Fahrzeug kommt (`map/drivePadding.ts#DRIVE_VEHICLE_X`).
  const einbau = useHandednessStore((state) => state.handedness);
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
      mapController.setDrivePadding(raenderFuer('fahrt', einbau));
      useViewModeStore.getState().setMode('3d-course');
      useFollowMeStore.getState().setFollowing(true);
      inDriveMode.current = true;
    } else if (!shouldBeInDriveMode && inDriveMode.current) {
      useFollowMeStore.getState().setFollowing(false);
      // Ausserhalb der Fahrt gehoert die Position wieder in die Mitte: dort
      // geht es ums Umsehen, nicht ums Vorausschauen. Auch hier zuerst, aus
      // demselben Grund wie oben.
      mapController.setDrivePadding(raenderFuer('ruhe', einbau));
      useViewModeStore.getState().setMode(priorViewMode.current ?? '2d-north');
      priorViewMode.current = null;
      inDriveMode.current = false;
    }
    // `einbau` steht absichtlich NICHT in der Liste: ein Umstellen waehrend
    // der Fahrt soll nicht den Modus neu betreten, sondern nur die Seite
    // wechseln -- das macht der Effekt darunter.
  }, [status, driveGateOpen]);

  // ─── DER ANKER ÄNDERT SICH, NICHT DER MODUS ─────────────────────────────
  // Links-/Rechtslenker umgestellt, die Position im Bildschirm-Anpassen
  // verschoben, die Karte ist (wieder) da oder anders groß: nur die Ränder
  // neu, für den Bildschirm, der gerade gilt. NICHT beim Wechsel Ruhe/Fahrt
  // -- den macht der Effekt oben, in der Reihenfolge, die er braucht.
  const map = useMapStore((state) => state.map);
  const fahrtAnker = useAnordnungStore((state) => state.werte.fahrt.kartenposition);
  const ruheAnker = useAnordnungStore((state) => state.werte.ruhe.kartenposition);
  const bearbeiten = useAnordnungStore((state) => state.bearbeiten);
  const [groesse, setGroesse] = useState(0);
  useEffect(() => {
    const neu = (): void => setGroesse((g) => g + 1);
    window.addEventListener('resize', neu);
    return () => window.removeEventListener('resize', neu);
  }, []);
  useEffect(() => {
    if (!map) return;
    mapController.setDrivePadding(raenderFuer(inDriveMode.current ? 'fahrt' : 'ruhe', einbau));
    // Beim Anpassen soll man SEHEN, wo die Position landet: auf sie
    // zentrieren -- die Ränder verschieben die Mitte dorthin.
    const position = usePositionStore.getState().position;
    if (bearbeiten && position) {
      mapController.setCamera({ center: [position.lon, position.lat] }, { animate: true, duration: 200 });
    }
    // `bearbeiten` steht absichtlich nicht in der Liste: das Öffnen des
    // Bearbeitens allein soll die Karte nicht bewegen.
  }, [map, einbau, fahrtAnker, ruheAnker, groesse]);

  return null;
}
