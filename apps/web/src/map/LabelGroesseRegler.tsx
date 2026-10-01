/**
 * Schieberegler für die Kartenbeschriftung, 80 % bis 200 %.
 *
 * Gewünscht: „einen Slider für die Labelgröße von 80 % bis 200 %". Vorher
 * gab es zwei Knöpfe, 100 % und 120 %.
 *
 * ─── WARUM NICHT BEI JEDER BEWEGUNG ─────────────────────────────────────────
 * Jede neue Größe ist ein neuer Kartenstil: der Kern schreibt die Schrift-
 * größen um, MapLibre tauscht den Stil aus. Beim Ziehen über den ganzen Weg
 * kämen so zwölf Stilwechsel in einer Sekunde -- auf einem Autoradio ruckelt
 * dann die ganze Karte. Die Zahl neben dem Regler folgt dem Finger sofort,
 * die Karte erst, wenn er kurz stillhält.
 */

import React, { useEffect, useState } from 'react';
import { LABEL_GROESSE_MAX, LABEL_GROESSE_MIN, LABEL_GROESSE_SCHRITT } from '@yapaia/shared';

/** So lange muss der Regler stillstehen, bevor die Karte nachzieht. */
export const UEBERNAHME_NACH_MS = 350;

export default function LabelGroesseRegler({
  wert,
  onWert,
}: {
  wert: string;
  onWert: (wert: string) => void;
}): React.ReactElement {
  const [entwurf, setEntwurf] = useState(wert);

  // Ändert sich der Wert von außen (anderes Gerät, Zurücksetzen), folgt der
  // Regler.
  useEffect(() => setEntwurf(wert), [wert]);

  useEffect(() => {
    if (entwurf === wert) return undefined;
    const zeitgeber = window.setTimeout(() => onWert(entwurf), UEBERNAHME_NACH_MS);
    return () => window.clearTimeout(zeitgeber);
  }, [entwurf, wert, onWert]);

  const prozent = Math.round(Number(entwurf) * 100);

  return (
    <div className="flex items-center gap-3">
      <input
        type="range"
        min={LABEL_GROESSE_MIN}
        max={LABEL_GROESSE_MAX}
        step={LABEL_GROESSE_SCHRITT}
        value={entwurf}
        onChange={(e) => setEntwurf(Number(e.target.value).toFixed(1))}
        aria-label="Label-Größe"
        aria-valuetext={`${prozent} Prozent`}
        className="h-8 flex-1 accent-blue-600"
        data-testid="labelscale-slider"
      />
      <span className="w-12 text-right text-xs tabular-nums" data-testid="labelscale-wert">
        {prozent} %
      </span>
    </div>
  );
}
