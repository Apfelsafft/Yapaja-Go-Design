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

import React, { useCallback } from 'react';
import { recenterOnPosition } from './followMe';
import { usePositionStore } from '../position/positionStore';
import { rightStackBottomPx, EDGE_INSET_PX } from '../shell/mapControlLayout.js';
import { useNavStore } from '../drive/navStore.js';
import { isDriveActive } from '../drive/driveActive.js';

export default function ReCenterButton(): React.ReactElement | null {
  const driveActive = isDriveActive(useNavStore((state) => state.navState?.status));
  const hasPosition = usePositionStore((state) => state.position !== null);

  const handleClick = useCallback(() => {
    recenterOnPosition();
  }, []);

  if (!hasPosition) {
    return null;
  }

  return (
    <button
      onClick={handleClick}
      style={{ bottom: rightStackBottomPx('recenter', driveActive), right: EDGE_INSET_PX }}
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
