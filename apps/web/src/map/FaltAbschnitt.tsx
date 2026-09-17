/**
 * Ein Abschnitt im Karten-Menü, der sich zuklappen lässt.
 *
 * ─── WARUM EIN EIGENER BAUSTEIN UND KEIN `<details>` ────────────────────────
 * `<details>`/`<summary>` täte dasselbe und wäre kürzer. Es bringt aber ein
 * eigenes Dreieck und eine eigene Bedienlogik mit, die sich je nach Browser
 * unterscheiden — und Yapaia wird auf einem iPad, einem iPhone und in der
 * Home-Assistant-App bedient. Drei Darstellungen desselben Menüs wären ein
 * Preis, den diese Ersparnis nicht wert ist.
 *
 * ─── DIE TREFFERFLÄCHE ──────────────────────────────────────────────────────
 * Die ganze Überschrift schaltet, nicht nur das Dreieck. Im fahrenden
 * Fahrzeug ist ein 12-Punkte-Ziel nicht zu treffen — und wer danebentippt,
 * sieht einfach nichts passieren und versucht es noch einmal.
 */

import React, { useState } from 'react';

export interface FaltAbschnittProps {
  titel: string;
  /** Beim ersten Anzeigen offen? Danach entscheidet der Betreiber. */
  offen: boolean;
  /** Für `data-testid` — der Abschnitt ist sonst nicht auffindbar. */
  id: string;
  children: React.ReactNode;
}

export default function FaltAbschnitt({
  titel,
  offen,
  id,
  children,
}: FaltAbschnittProps): React.ReactElement {
  const [istOffen, setIstOffen] = useState(offen);

  return (
    <section data-testid={`panel-abschnitt-${id}`}>
      <button
        type="button"
        onClick={() => setIstOffen((v) => !v)}
        aria-expanded={istOffen}
        data-testid={`panel-abschnitt-schalter-${id}`}
        className="flex w-full items-center justify-between rounded-lg px-1 py-1.5 text-left font-semibold hover:bg-slate-100 dark:hover:bg-slate-700"
      >
        <span>{titel}</span>
        {/* Das Dreieck dreht sich, statt das Zeichen zu wechseln: ein
            Zeichenwechsel springt, eine Drehung zeigt die Bewegung. */}
        <span
          aria-hidden="true"
          className={`text-slate-400 transition-transform ${istOffen ? 'rotate-90' : ''}`}
        >
          ▸
        </span>
      </button>
      {istOffen && <div className="mt-1">{children}</div>}
    </section>
  );
}
