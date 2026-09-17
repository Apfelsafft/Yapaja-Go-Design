/**
 * „Für A3 liegen gerade keine Verkehrsdaten vor."
 *
 * ─── WOFÜR DIESER HINWEIS DA IST ────────────────────────────────────────────
 * Eine Karte ohne Baustellensymbole kann zweierlei heißen: es ist nichts
 * gemeldet, oder es konnte niemand nachsehen. Beides sieht gleich aus — und
 * für jemanden, der auf eine gesperrte Autobahn zufährt, ist das der ganze
 * Unterschied.
 *
 * Genau diese Verwechslung verfolgt dieses Projekt seit Monaten: bei den
 * Kartenregionen (leere Fläche statt „hier gibt es keine Karte"), beim
 * Routing (Route unmöglich statt „für dieses Land gibt es keinen Graphen"),
 * bei den LKW-Parkplätzen („alle brauchbar" für sechzig Einträge ohne Ort).
 * Jedes Mal war die Auskunft vorhanden und nur nicht erreichbar.
 *
 * ─── UND WARUM ER MEISTENS NICHT DA IST ─────────────────────────────────────
 * Ein Hinweis, der bei jeder Fahrt steht, wird nach drei Tagen nicht mehr
 * gelesen. `verkehrHinweisText.ts` entscheidet, wann etwas zu sagen ist; die
 * Abwägung steht dort und ist dort geprüft. Diese Datei zeigt nur an.
 */

import React from 'react';
import { useVerkehrStore } from './verkehrStore.js';
import { verkehrHinweis } from './verkehrHinweisText.js';

export default function VerkehrHinweis(): React.ReactElement | null {
  const strassen = useVerkehrStore((s) => s.strassen);
  const ohneOrt = useVerkehrStore((s) => s.ohneOrt);
  const fehler = useVerkehrStore((s) => s.fehler);

  const hinweis = verkehrHinweis({ strassen, ohneOrt, fehler });
  if (hinweis === null) return null;

  const warnung = hinweis.stufe === 'warnung';
  return (
    <div
      // Unterhalb des Regionen-Hinweises, damit sich die beiden nicht
      // überdecken, wenn sie einmal gleichzeitig zutreffen.
      className="pointer-events-none fixed left-1/2 top-48 z-30 w-[min(92vw,30rem)] -translate-x-1/2"
      data-testid="verkehr-hinweis"
    >
      <div
        role="status"
        className={
          'pointer-events-auto rounded-lg px-3 py-2 text-xs shadow-lg ' +
          (warnung
            ? 'border border-amber-300 bg-amber-50/95 text-amber-900 dark:border-amber-700 dark:bg-amber-950/95 dark:text-amber-100'
            : 'border border-slate-300 bg-white/95 text-slate-700 dark:border-slate-600 dark:bg-slate-900/95 dark:text-slate-200')
        }
      >
        {hinweis.text}
      </div>
    </div>
  );
}
