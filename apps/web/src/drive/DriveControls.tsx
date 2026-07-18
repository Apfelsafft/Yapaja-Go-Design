/**
 * Drive-mode Pause/Resume/Stop controls (E04-T5). Rendered by `DriveOverlay`
 * exactly when the maneuver panel is (an active, acknowledged drive session)
 * -- see that file's `active` gate.
 */

import React, { useCallback, useState } from 'react';
import type { NavState } from '@yapaja/shared';
import { pauseNavigation, resumeNavigation, stopNavigation, NavigationApiError } from './client.js';
import { useNavStore } from './navStore.js';
import { useHandednessStore } from '../shell/handednessStore.js';
import { sideClassFor, itemsAlignClassFor } from '../shell/handedness.js';

export default function DriveControls(): React.ReactElement {
  const status = useNavStore((state) => state.navState?.status ?? null);
  const handedness = useHandednessStore((state) => state.handedness);
  const setNavState = useNavStore((state) => state.setNavState);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const run = useCallback(
    async (action: () => Promise<NavState>) => {
      setBusy(true);
      setError(null);
      try {
        const state = await action();
        setNavState(state);
      } catch (err) {
        setError(err instanceof NavigationApiError ? err.message : 'Aktion fehlgeschlagen.');
      } finally {
        setBusy(false);
      }
    },
    [setNavState],
  );

  const handlePause = useCallback(() => void run(pauseNavigation), [run]);
  const handleResume = useCallback(() => void run(resumeNavigation), [run]);
  const handleStop = useCallback(() => void run(stopNavigation), [run]);

  // Touch-target audit (E07-T4, docs/06 §4: "im Drive-Modus ≥ 64 px"):
  // these buttons are ONLY ever rendered while a drive session is active
  // (`DriveOverlay.tsx`'s `active` gate) -- the definitive "drive-mode
  // controls" this task's audit targets, per its own explicit callout of
  // this file's testids. `min-h-[64px] min-w-[64px]` satisfies the ≥64px
  // bounding-box requirement; `gap-3` (12px) between Pause/Resume and Stop
  // comfortably clears the ≥8px spacing requirement ("Rüttelpiste").
  //
  // SAFETY INVARIANT: Stop is NEVER gated by the Speed-Lock (see
  // `drive/driveLock.ts#isControlLocked`'s unconditional `'drive-stop'`
  // early return) -- this component deliberately never even checks
  // `driveLockStore`, so there is no code path here that COULD lock it.
  // Pause/Resume are the same (documented decision, `driveLock.ts`).
  const sideClass = sideClassFor(handedness);
  const alignClass = itemsAlignClassFor(handedness);

  return (
    <div
      className={`absolute bottom-4 ${sideClass} z-20 flex flex-col ${alignClass} gap-2`}
      data-testid="drive-controls"
    >
      {error && (
        <p
          className="rounded-md bg-red-50 dark:bg-red-900/30 border border-red-200 dark:border-red-800 text-red-700 dark:text-red-300 px-2 py-1 text-xs"
          data-testid="drive-controls-error"
        >
          {error}
        </p>
      )}
      <div className="flex gap-3">
        {status === 'paused' ? (
          <button
            type="button"
            onClick={handleResume}
            disabled={busy}
            aria-label="Navigation fortsetzen"
            className="min-h-[64px] min-w-[64px] rounded-full bg-blue-600 text-white px-4 py-2 text-sm font-medium shadow-lg disabled:opacity-50"
            data-testid="drive-resume-button"
          >
            ▶ Fortsetzen
          </button>
        ) : (
          <button
            type="button"
            onClick={handlePause}
            disabled={busy}
            aria-label="Navigation pausieren"
            className="min-h-[64px] min-w-[64px] rounded-full bg-slate-900/90 text-white px-4 py-2 text-sm font-medium shadow-lg disabled:opacity-50"
            data-testid="drive-pause-button"
          >
            ⏸ Pause
          </button>
        )}
        <button
          type="button"
          onClick={handleStop}
          disabled={busy}
          aria-label="Navigation stoppen"
          className="min-h-[64px] min-w-[64px] rounded-full bg-red-600 text-white px-4 py-2 text-sm font-medium shadow-lg disabled:opacity-50"
          data-testid="drive-stop-button"
        >
          ⏹ Stopp
        </button>
      </div>
    </div>
  );
}
