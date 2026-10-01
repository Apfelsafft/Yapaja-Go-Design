/**
 * Re-Center Button (E01-T3)
 *
 * ─── GEÄNDERT NACH EINER RÜCKMELDUNG AUS DEM BETRIEB ────────────────────────
 * Bis 0.3.2 erschien dieser Knopf NUR, wenn Follow-Me pausiert war — also nur
 * nach einem manuellen Schwenk mit dem Finger. Eine Suche bewegt die Karte
 * aber programmatisch (`flyTo`), und das pausiert Follow-Me absichtlich
 * nicht. Nach einer Suche war der Knopf deshalb nicht da, und die Karte kam
 * erst beim nächsten eintreffenden Fix zurück — bei der Companion App als
 * Quelle können das Minuten sein.
 *
 * Der Betreiber hat genau danach gefragt: „Bitte baue noch einen Button ein
 * der nach einem suchen auf der Karte mich schnell wieder an die aktuelle
 * Position bringt."
 *
 * Der Knopf ist jetzt immer da, SOLANGE es eine Position gibt. Ohne Position
 * bleibt er weg — ein Knopf, der sicher nichts tut, ist schlechter als
 * keiner, und „zurück zu nichts" ist kein Ziel.
 */

import { useKartenSeite } from '../shell/bedienSeite.js';
import React, { useCallback, useEffect, useState } from 'react';
import { recenterOnPosition, useFollowMeIsPaused, useFollowMeStore } from './followMe';
import { useMapStore } from '../state/mapStore';
import { usePositionStore } from '../position/positionStore';
import { rightStackBottomPx, EDGE_INSET_PX } from '../shell/mapControlLayout.js';
import { useSchmal } from '../shell/useSchmal.js';
import { useNavStore } from '../drive/navStore.js';
import { isDriveActive } from '../drive/driveActive.js';

/** Ab dieser Entfernung zwischen Kartenmitte und Position gilt die Karte als woanders. */
export const WEG_AB_PX = 40;

export default function ReCenterButton(): React.ReactElement | null {
  // Gegenüber dem Seitenpanel (shell/bedienSeite.ts).
  const kartenSeite = useKartenSeite();
  const driveActive = isDriveActive(useNavStore((state) => state.navState?.status));
  const schmal = useSchmal();
  const hasPosition = usePositionStore((state) => state.position !== null);
  const pausiert = useFollowMeIsPaused();
  const map = useMapStore((state) => state.map);
  const [weg, setWeg] = useState(false);

  // ─── NUR WENN MAN NICHT DORT IST ────────────────────────────────────────
  // Gewuenscht: der Zentrier-Button erscheint nur, wenn man gerade (etwa
  // durch Suchen) auf der Karte nicht auf der aktuellen Position ist.
  //
  // Bis 0.21 war er IMMER da. Davor hing er an der Follow-Me-Pause, und das
  // ging schief: eine Suche bewegt die Karte, ohne zu pausieren, und der
  // Knopf fehlte genau dann, wenn man ihn brauchte (siehe viewmode.spec.ts).
  //
  // Jetzt wird gemessen, wo die Karte WIRKLICH steht: liegt die Position
  // mehr als WEG_AB_PX vom Kartenmittelpunkt entfernt, erscheint der Knopf.
  // Geprueft wird nach jeder abgeschlossenen Bewegung (`moveend`) -- nicht
  // waehrenddessen, sonst flackerte er beim Mitfahren mit jedem Fix, solange
  // die Kamera der neuen Position noch hinterhergleitet.
  useEffect(() => {
    if (!map) return undefined;
    const pruefen = (): void => {
      const p = usePositionStore.getState().position;
      if (!p) {
        setWeg(false);
        return;
      }
      const a = map.project([p.lon, p.lat]);
      const c = map.project(map.getCenter());
      setWeg(Math.hypot(a.x - c.x, a.y - c.y) > WEG_AB_PX);
    };
    map.on('moveend', pruefen);
    // Steht die Kamera still (Follow-Me pausiert), entfernt sich die Position
    // von selbst -- dann auch bei jedem neuen Fix nachsehen.
    const abmelden = usePositionStore.subscribe(() => {
      if (useFollowMeStore.getState().isPaused) pruefen();
    });
    pruefen();
    return () => {
      map.off('moveend', pruefen);
      abmelden();
    };
  }, [map]);

  const handleClick = useCallback(() => {
    recenterOnPosition();
  }, []);

  if (!hasPosition || !(weg || pausiert)) {
    return null;
  }

  return (
    <button
      onClick={handleClick}
      style={{ bottom: rightStackBottomPx('recenter', driveActive, schmal), [kartenSeite]: EDGE_INSET_PX }}
      className="fixed w-12 h-12 rounded-full bg-blue-500 dark:bg-blue-600 text-white shadow-lg hover:shadow-xl hover:bg-blue-600 dark:hover:bg-blue-700 transition-all flex items-center justify-center focus:outline-none focus:ring-2 focus:ring-blue-300 focus:ring-offset-2 dark:focus:ring-offset-slate-900"
      aria-label="Zur Position zurückkehren"
      title="Zur Position zurückkehren"
      data-testid="recenter-button"
    >
      {/* Crosshair icon */}
      <svg
        className="w-5 h-5"
        fill="none"
        stroke="currentColor"
        viewBox="0 0 24 24"
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <circle cx="12" cy="12" r="1" />
        <path d="M12 8v-2M12 18v2M8 12H6M18 12h2" />
      </svg>
    </button>
  );
}
