/**
 * „Ihre Position liegt in keiner installierten Karte."
 *
 * ─── WOFUER DIESER HINWEIS DA IST ───────────────────────────────────────────
 * Es gibt einen Zustand, in dem Yapaia bis 2026-09-03 vollkommen still eine
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
 *
 * ─── SEIT 0.16.0 GIBT ES NUR NOCH EINEN FALL ────────────────────────────────
 * Bis 0.15.3 hatte dieser Hinweis zwei Gesichter. Das zweite hiess „Andere
 * Region aufgeschlagen" und galt, wenn jemand im Kartenmenue eine feste
 * Region gewaehlt hatte. Diese Wahl gibt es nicht mehr: gezeichnet wird immer
 * alles Installierte.
 *
 * Damit bleibt genau die Lage, fuer die dieser Hinweis erfunden wurde — der
 * weisse Fleck, fuer den KEINE Karte installiert ist. Und die ist jetzt sogar
 * eindeutig: weisse Flaeche heisst ab hier zuverlaessig „nicht
 * heruntergeladen" und nichts anderes mehr.
 */

import React from 'react';
import { pickActiveRegion } from './activeRegion';
import { useRegionStore } from './regionStore';
import { usePosition } from '../position/positionStore';

export default function RegionCoverageNotice(): React.ReactElement | null {
  const regions = useRegionStore((state) => state.regions);
  const position = usePosition();

  const choice = pickActiveRegion({ regions, point: position });

  if (!choice.positionOutsideAllRegions) {
    return null;
  }

  return (
    <div
      className="fixed top-32 left-1/2 -translate-x-1/2 z-30 w-[min(92vw,30rem)] pointer-events-none"
      data-testid="region-coverage-notice-container"
    >
      <div
        className="pointer-events-auto rounded-lg bg-amber-50/95 dark:bg-amber-950/95 border border-amber-300 dark:border-amber-700 shadow-lg px-3 py-2 text-xs text-amber-900 dark:text-amber-100"
        data-testid="region-coverage-notice"
      >
        <p>
          <span className="font-semibold">Für Ihre Position gibt es keine Karte.</span> Die
          aktuelle Position liegt außerhalb aller installierten Regionen
          {regions.length > 0 && ` (${regions.map((r) => r.region).join(', ')})`} — die Karte
          bleibt hier leer, obwohl mit ihr nichts nicht in Ordnung ist. Passende Region unter
          „Karten verwalten" (🗺️) installieren.
        </p>
      </div>
    </div>
  );
}
