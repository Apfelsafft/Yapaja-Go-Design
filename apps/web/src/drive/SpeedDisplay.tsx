/**
 * Tachoanzeige: die aktuelle Geschwindigkeit.
 *
 * Gewünscht: „Ich hätte gerne überhaupt eine Anzeige der Geschwindigkeit."
 *
 * Sie hängt an der POSITION, nicht an der Navigation — eine Anzeige, die nur
 * während einer geplanten Route funktioniert, wäre keine. Die Umrechnung und
 * die Frage „zeigen oder nicht" stehen in `speedDisplay.ts` und sind dort
 * ohne Browser geprüft.
 *
 * Platz: unten links ÜBER dem Zahnrad. Die anderen Ecken sind belegt
 * (Kopfzeile oben, Karten-Bedienelemente rechts, Favoritenleiste unten
 * mittig) — und ein Bedienelement zu verdecken war in diesem Projekt schon
 * dreimal ein gemeldeter Fehler.
 */

import React from 'react';
import { usePosition } from '../position/positionStore.js';
import { displayedSpeedKmh } from './speedDisplay.js';

export default function SpeedDisplay(): React.ReactElement | null {
  const position = usePosition();
  const kmh = displayedSpeedKmh(position?.speed ?? null);
  if (kmh === null) return null;

  return (
    <div
      data-testid="speed-display"
      className="fixed bottom-20 left-4 z-10 flex items-baseline gap-1 rounded-xl bg-white/90 dark:bg-slate-800/90 px-3 py-2 shadow-lg pointer-events-none"
    >
      <span
        data-testid="speed-display-value"
        className="text-2xl font-semibold tabular-nums text-slate-900 dark:text-slate-100"
      >
        {kmh}
      </span>
      <span className="text-xs text-slate-500 dark:text-slate-400">km/h</span>
    </div>
  );
}
