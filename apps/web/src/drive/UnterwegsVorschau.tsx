/**
 * Vorschau eines Ortes aus „Unterwegs finden" -- erst ansehen, dann
 * entscheiden.
 *
 * Gewünscht: „Ein Klick macht sie derzeit zum Zwischenziel. Können wir einen
 * Schritt dazwischen einbauen? Ein Klick zeigt diesen POI auf der Karte an,
 * damit man ihn sieht. Dann kann man eventuell einen anderen auswählen oder
 * eben diesen als Zwischenziel einfügen."
 *
 * Die Karte fliegt zum Ort, eine Markierung zeigt ihn, und die Kamera HÄLT
 * dort (`followMe.halten`) -- nach zehn Sekunden zurückzuspringen, während
 * man sich den Ort ansieht, wäre falsch. Mit ◀ ▶ blättert man durch die
 * übrigen Treffer derselben Suche. Schließen oder Einfügen holt die Karte
 * zurück zur Position.
 */

import React, { useEffect } from 'react';
import * as maplibregl from 'maplibre-gl';
import { mapController } from '../state/mapStore.js';
import { recenterOnPosition, useFollowMeStore } from '../map/followMe.js';
import { stationsZeile } from '../bord/bordStore.js';
import type { UnterwegsErgebnis } from './UnterwegsFinden.js';

export interface Vorschau {
  ergebnis: UnterwegsErgebnis;
  index: number;
}

export default function UnterwegsVorschau({
  vorschau,
  bottomPx,
  onBlaettern,
  onEinfuegen,
  onListe,
  onSchliessen,
}: {
  vorschau: Vorschau;
  bottomPx: number;
  onBlaettern: (index: number) => void;
  onEinfuegen: () => void;
  onListe: () => void;
  onSchliessen: () => void;
}): React.ReactElement {
  const treffer = vorschau.ergebnis.treffer;
  const t = treffer[vorschau.index]!;

  // Karte zum Ort, Markierung setzen; beim Wechsel oder Schließen wieder weg.
  useEffect(() => {
    const map = mapController.getMap();
    if (!map) return undefined;
    useFollowMeStore.getState().halten();
    map.flyTo({ center: [t.lon, t.lat], zoom: Math.max(map.getZoom(), 14), duration: 600 });
    const markierung = new maplibregl.Marker({ color: '#7C3AED' }).setLngLat([t.lon, t.lat]).addTo(map);
    markierung.getElement().setAttribute('data-testid', 'unterwegs-vorschau-markierung');
    return () => {
      markierung.remove();
    };
  }, [t.lat, t.lon]);

  const schliessen = (): void => {
    onSchliessen();
    recenterOnPosition();
  };

  return (
    <div
      role="dialog"
      aria-label={`Vorschau: ${t.name}`}
      style={{ bottom: bottomPx }}
      className="absolute left-1/2 z-30 w-[min(calc(var(--sicht-b,100vw)*0.92),26rem)] -translate-x-1/2 space-y-2 rounded-xl bg-white/95 p-3 text-sm text-slate-800 shadow-xl dark:bg-slate-800/95 dark:text-slate-100"
      data-testid="unterwegs-vorschau"
    >
      <div className="flex items-start gap-2">
        <p className="flex-1 font-semibold" data-testid="unterwegs-vorschau-name">
          {stationsZeile(t)}
        </p>
        <button
          type="button"
          onClick={schliessen}
          aria-label="Vorschau schließen"
          className="h-10 w-10 shrink-0 rounded-full hover:bg-slate-100 dark:hover:bg-slate-700"
          data-testid="unterwegs-vorschau-schliessen"
        >
          ✕
        </button>
      </div>
      <div className="flex items-center gap-2">
        {treffer.length > 1 && (
          <>
            <button
              type="button"
              onClick={() => onBlaettern((vorschau.index - 1 + treffer.length) % treffer.length)}
              aria-label="Vorheriger Treffer"
              className="min-h-[48px] min-w-[48px] rounded-full bg-slate-100 dark:bg-slate-700"
              data-testid="unterwegs-vorschau-zurueck"
            >
              ◀
            </button>
            <span className="text-xs tabular-nums text-slate-500" data-testid="unterwegs-vorschau-zaehler">
              {vorschau.index + 1}/{treffer.length}
            </span>
            <button
              type="button"
              onClick={() => onBlaettern((vorschau.index + 1) % treffer.length)}
              aria-label="Nächster Treffer"
              className="min-h-[48px] min-w-[48px] rounded-full bg-slate-100 dark:bg-slate-700"
              data-testid="unterwegs-vorschau-weiter"
            >
              ▶
            </button>
          </>
        )}
        <button
          type="button"
          onClick={onListe}
          className="min-h-[48px] rounded-full bg-slate-100 px-3 dark:bg-slate-700"
          data-testid="unterwegs-vorschau-liste"
        >
          Liste
        </button>
        <button
          type="button"
          onClick={() => {
            onEinfuegen();
            recenterOnPosition();
          }}
          className="ml-auto min-h-[48px] rounded-full bg-blue-600 px-4 font-semibold text-white"
          data-testid="unterwegs-vorschau-einfuegen"
        >
          Als Zwischenziel
        </button>
      </div>
    </div>
  );
}
