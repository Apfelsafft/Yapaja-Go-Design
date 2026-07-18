/**
 * The Speed-Lock overlay UI (E07-T4, docs/06 §4): replaces a locked
 * surface's content with "Während der Fahrt gesperrt" + an "Ich bin
 * Beifahrer" button that runs a 5-second countdown, then unlocks (remembered
 * for the session -- see `driveLockStore.ts`'s `sessionStorage` persistence).
 *
 * Purely presentational + the countdown START/CANCEL wiring; the countdown
 * itself (real timer, session-remember) lives in `driveLockStore.ts`. Used by
 * `DriveLockGate.tsx`, which decides WHETHER to render this in place of a
 * surface's normal content.
 */

import React from 'react';
import { useDriveLockStore } from './driveLockStore.js';

export default function DriveLockOverlay(): React.ReactElement {
  const countdownRemainingMs = useDriveLockStore((state) => state.countdownRemainingMs);
  const startPassengerOverride = useDriveLockStore((state) => state.startPassengerOverride);
  const cancelCountdown = useDriveLockStore((state) => state.cancelPassengerOverrideCountdown);

  const countingDown = countdownRemainingMs !== null;
  const remainingS = countingDown ? Math.ceil((countdownRemainingMs as number) / 1000) : null;

  return (
    <div
      className="p-4 space-y-3 text-center"
      data-testid="drive-lock-overlay"
      role="alertdialog"
      aria-label="Während der Fahrt gesperrt"
    >
      <p className="text-2xl" aria-hidden="true">
        🔒
      </p>
      <p className="font-semibold text-slate-800 dark:text-slate-100">Während der Fahrt gesperrt</p>
      <p className="text-xs text-slate-500 dark:text-slate-400">
        Diese Ansicht ist während der Fahrt aus Sicherheitsgründen gesperrt.
      </p>
      {countingDown ? (
        <div className="space-y-2">
          <p
            className="text-sm font-medium text-amber-700 dark:text-amber-400"
            data-testid="drive-lock-countdown"
            role="status"
            aria-live="polite"
          >
            Entsperre in {remainingS}…
          </p>
          <button
            type="button"
            onClick={cancelCountdown}
            aria-label="Beifahrer-Freigabe abbrechen"
            className="min-h-[48px] px-4 py-2 rounded-md border border-slate-300 dark:border-slate-600 text-sm text-slate-600 dark:text-slate-300"
            data-testid="drive-lock-cancel-button"
          >
            Abbrechen
          </button>
        </div>
      ) : (
        <button
          type="button"
          onClick={startPassengerOverride}
          aria-label="Ich bin Beifahrer -- Sperre nach 5 Sekunden aufheben"
          className="min-h-[48px] w-full px-4 py-2 rounded-md bg-blue-600 text-white text-sm font-medium hover:bg-blue-700"
          data-testid="drive-lock-passenger-button"
        >
          Ich bin Beifahrer
        </button>
      )}
    </div>
  );
}
