/**
 * „Ihre Position liegt in keiner installierten Karte."
 *
 * ─── WOFUER DIESER HINWEIS DA IST ───────────────────────────────────────────
 * Es gibt einen Zustand, in dem Yapaja bis 2026-09-03 vollkommen still eine
 * leere Flaeche zeigte: die eigene Position liegt ausserhalb jeder gebauten
 * Region. Die Karte ist dann technisch in Ordnung, der Kachelsatz ist
 * vollstaendig, der Routinggraph steht — es gibt an dieser Stelle nur keine
 * Daten. Von aussen ist das nicht zu unterscheiden von einem fehlgeschlagenen
 * Kachelbau, und genau so hat es der erste Betreiber auch gelesen: er hatte
 * Rheinland-Pfalz gebaut und sah eine leere Karte.
 *
 * Eine leere Flaeche ohne Erklaerung schickt den Adressaten auf die
 * Fehlersuche in einer Installation, die funktioniert. Deshalb sagt dieser
 * Hinweis, was der Fall ist, und nennt den einen Weg heraus, den es gibt.
 *
 * Er erscheint NICHT, solange keine Position vorliegt: dann ist die Karte auf
 * die erste Region gefittet und zeigt Daten — es gibt nichts zu erklaeren.
 */

import React from 'react';
import { pickActiveRegion } from './activeRegion';
import { useRegionStore } from './regionStore';
import { usePosition } from '../position/positionStore';

export default function RegionCoverageNotice(): React.ReactElement | null {
  const regions = useRegionStore((state) => state.regions);
  const manual = useRegionStore((state) => state.manual);
  const position = usePosition();

  const choice = pickActiveRegion({ regions, point: position, manual });

  if (!choice.positionOutsideAllRegions) {
    return null;
  }

  // Eine ausdrueckliche Wahl ist eine Entscheidung, keine Verwechslung: wer
  // eine andere Region zum Planen aufgeschlagen hat, weiss, dass er nicht
  // dort ist. Dann bleibt der Hinweis knapper und ohne Handlungsdruck.
  const manualOverride = choice.reason === 'manual';

  return (
    <div
      className="fixed top-32 left-1/2 -translate-x-1/2 z-30 w-[min(92vw,30rem)] pointer-events-none"
      data-testid="region-coverage-notice-container"
    >
      <div
        className="pointer-events-auto rounded-lg bg-amber-50/95 dark:bg-amber-950/95 border border-amber-300 dark:border-amber-700 shadow-lg px-3 py-2 text-xs text-amber-900 dark:text-amber-100"
        data-testid="region-coverage-notice"
      >
        {manualOverride ? (
          <p>
            <span className="font-semibold">Andere Region aufgeschlagen.</span> Angezeigt wird
            „{choice.region?.region}"; Ihre aktuelle Position liegt dort nicht. Im Kartenmenü
            (🗺️) zurück auf „Automatisch".
          </p>
        ) : (
          <p>
            <span className="font-semibold">Für Ihre Position gibt es keine Karte.</span> Die
            aktuelle Position liegt außerhalb aller installierten Regionen
            {regions.length > 0 && ` (${regions.map((r) => r.region).join(', ')})`} — die Karte
            bleibt hier leer, obwohl mit ihr nichts nicht in Ordnung ist. Passende Region unter
            „Kartenregionen verwalten" (🗺️) bauen.
          </p>
        )}
      </div>
    </div>
  );
}
