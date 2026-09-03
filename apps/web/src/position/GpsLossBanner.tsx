/**
 * GPS-Loss Banner (E02-T5, W-01)
 *
 * Shows "GPS-Signal verloren" whenever no real GPS fix has arrived for longer
 * than the threshold that applies to the active source (see gpsSignal.ts —
 * 3 s for a continuous source, 5 min for an interval one). Styled like
 * GeolocationHints: a `fixed`, `pointer-events-none` overlay container so it
 * never shifts layout, with only the inner card re-enabling pointer events.
 *
 * ─── WO ES STEHT, UND WARUM DORT ────────────────────────────────────────────
 * Bis 2026-09-03 lag dieses Banner auf `top-4 left-4 right-4` und OHNE
 * z-index. Auf derselben Zeile sitzen aber drei andere Dinge: der Titel
 * „Yapaja Go" (App.tsx, `absolute top-0 left-0`), die Profil-Auswahl
 * (`fixed top-4 left-44 z-10`) und die Suchleiste (`fixed top-4 … z-20`).
 * Und `PositionInitializer` — in dem dieses Banner haengt — steht in
 * `App.tsx` VOR allen dreien, also malt es zuerst und liegt zuunterst.
 *
 * Ergebnis im Betrieb: die Meldung war da, aber nicht zu lesen. Der Betreiber
 * hat es genau so berichtet — „Bekomme aber auch eine Fehlermeldung am oberen
 * Rand des screens. Kann sie nicht lesen da andere Objekte sie verdecken."
 * Eine Warnung, die von der Bedienoberflaeche verdeckt wird, ist keine.
 *
 * Der z-index allein hätte es nicht behoben, sondern nur umgedreht: dann
 * liegt das Banner ueber der Suchleiste und verdeckt das Eingabefeld. Es
 * braucht eine eigene Zeile. `top-20` liegt unter der Kopfzeile und ueber der
 * Karte; `z-30` liegt ueber Suchleiste (z-20) und Profil-Auswahl (z-10), aber
 * unter den Dialogen (UpdatePrompt z-40, Menues z-50), die eine Antwort
 * verlangen. Die Breite ist begrenzt und zentriert, damit rechts die
 * Zoom-Bedienelemente von MapLibre frei bleiben.
 */

import React from 'react';
import { useGpsSignalState } from './gpsSignal';
import { usePositionConnected } from './positionStore';

export default function GpsLossBanner(): React.ReactElement | null {
  const signalState = useGpsSignalState();
  const isConnected = usePositionConnected();

  if (signalState !== 'lost' || !isConnected) {
    return null;
  }

  return (
    <div
      className="fixed top-20 left-1/2 -translate-x-1/2 z-30 w-[min(92vw,26rem)] pointer-events-none"
      data-testid="gps-loss-banner-container"
    >
      <div className="pointer-events-auto">
        <div
          className="bg-slate-800/95 dark:bg-slate-900/95 text-white border border-slate-600 rounded-lg px-3 py-2 shadow-lg flex items-center gap-3"
          data-testid="gps-loss-banner"
        >
          <div className="flex-shrink-0 text-lg" aria-hidden="true">
            📡
          </div>
          <p className="font-semibold">GPS-Signal verloren</p>
        </div>
      </div>
    </div>
  );
}
