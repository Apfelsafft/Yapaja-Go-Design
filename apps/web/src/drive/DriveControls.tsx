/**
 * Drive-mode Pause/Resume/Stop controls (E04-T5). Rendered by `DriveOverlay`
 * exactly when the maneuver panel is (an active, acknowledged drive session)
 * -- see that file's `active` gate.
 */

import React, { useCallback, useState } from 'react';
import type { NavState } from '@yapaja/shared';
import { pauseNavigation, resumeNavigation, stopNavigation, NavigationApiError } from './client.js';
import { useNavStore } from './navStore.js';

export default function DriveControls(): React.ReactElement {
  const status = useNavStore((state) => state.navState?.status ?? null);
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

  return (
    <div
      className="absolute bottom-4 right-3 z-20 flex flex-col items-end gap-2"
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
      <div className="flex gap-2">
        {status === 'paused' ? (
          <button
            type="button"
            onClick={handleResume}
            disabled={busy}
            className="rounded-full bg-blue-600 text-white px-4 py-2 text-sm font-medium shadow-lg disabled:opacity-50"
            data-testid="drive-resume-button"
          >
            ▶ Fortsetzen
          </button>
        ) : (
          <button
            type="button"
            onClick={handlePause}
            disabled={busy}
            className="rounded-full bg-slate-900/90 text-white px-4 py-2 text-sm font-medium shadow-lg disabled:opacity-50"
            data-testid="drive-pause-button"
          >
            ⏸ Pause
          </button>
        )}
        <button
          type="button"
          onClick={handleStop}
          disabled={busy}
          className="rounded-full bg-red-600 text-white px-4 py-2 text-sm font-medium shadow-lg disabled:opacity-50"
          data-testid="drive-stop-button"
        >
          ⏹ Stopp
        </button>
      </div>
    </div>
  );
}
