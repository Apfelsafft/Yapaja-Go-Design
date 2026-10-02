/**
 * Der 🎤-Knopf während der Fahrt: oben in der Knopfspalte auf der Kartenseite.
 * Ein Tipp, dann sprechen -- „höchstens ein Tipp" (docs/ideen-ki.md).
 */

import React from 'react';
import { useSprachStore } from './sprachStore.js';
import { useKartenSeite } from '../shell/bedienSeite.js';
import { useSchmal } from '../shell/useSchmal.js';
import { EDGE_INSET_PX, rightStackBottomPx } from '../shell/mapControlLayout.js';
import { useAnordnung } from '../shell/useAnordnung.js';

export default function FahrtMikrofon(): React.ReactElement {
  const anordnung = useAnordnung('mikrofon');
  const oeffne = useSprachStore((s) => s.oeffne);
  const kartenSeite = useKartenSeite();
  const schmal = useSchmal();
  return (
    <button
      ref={anordnung.ref}
      type="button"
      onClick={oeffne}
      aria-label="Sprachbefehl"
      style={{ bottom: rightStackBottomPx('mikrofon', true, schmal), [kartenSeite]: EDGE_INSET_PX }}
      className="fixed z-20 flex h-12 w-12 items-center justify-center rounded-full bg-blue-600 text-xl text-white shadow-lg hover:bg-blue-700"
      data-testid="fahrt-mikrofon"
    >
      🎤
      {anordnung.griff}
    </button>
  );
}
