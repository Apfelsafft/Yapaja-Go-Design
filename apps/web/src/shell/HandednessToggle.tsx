/**
 * LHD/RHD FAB-mirroring toggle (E07-T4), part of the Settings surface
 * (`StylePanel.tsx`). Picking a side flips the drive-mode FAB cluster
 * (`DriveControls.tsx` + the TTS toggle, see `handedness.ts`'s doc comment
 * for why those two specifically) to that side of the screen.
 */

import React from 'react';
import { useHandednessStore } from './handednessStore.js';
import type { Handedness } from './handedness.js';

const OPTIONS: Array<{ value: Handedness; label: string }> = [
  { value: 'lhd', label: 'Linkslenker (LHD)' },
  { value: 'rhd', label: 'Rechtslenker (RHD)' },
];

export default function HandednessToggle(): React.ReactElement {
  const handedness = useHandednessStore((state) => state.handedness);
  const setHandedness = useHandednessStore((state) => state.setHandedness);

  return (
    <section>
      {/* Seit 0.18.0 entscheidet diese Einstellung, in welchem unteren
          Viertel das Fahrzeug waehrend der Fahrt sitzt
          (`map/drivePadding.ts#DRIVE_VEHICLE_X`). Die Knoepfe, die sie
          vorher auf die andere Seite legte, liegen jetzt im Fahrtmenue. */}
      <h2 className="font-semibold mb-2">Lenkrad (LHD/RHD)</h2>
      <p className="mb-2 text-xs text-slate-500 dark:text-slate-400">
        Während der Fahrt sitzt das Fahrzeug im unteren Viertel auf der Fahrerseite.
      </p>
      <div className="flex gap-1" role="group" aria-label="Lenkrad (LHD/RHD)">
        {OPTIONS.map((opt) => (
          <button
            key={opt.value}
            type="button"
            onClick={() => setHandedness(opt.value)}
            aria-pressed={opt.value === handedness}
            aria-label={opt.label}
            data-testid={`handedness-option-${opt.value}`}
            className={`px-2 py-1 rounded-md border text-xs ${
              opt.value === handedness
                ? 'border-blue-500 bg-blue-50 dark:bg-blue-900/40 font-semibold'
                : 'border-slate-300 dark:border-slate-600'
            }`}
          >
            {opt.label}
          </button>
        ))}
      </div>
    </section>
  );
}
