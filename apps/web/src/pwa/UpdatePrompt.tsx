/**
 * "Update verfügbar" reload prompt (E07-T5): shown ONLY once a new Service
 * Worker build is ready (`pwaStore.updateAvailable`, set by
 * `registerServiceWorker.ts`'s `onNeedReload`) AND the vehicle is at
 * standstill (`reloadGate.ts#shouldPromptReload`, reusing the same
 * Speed-Lock threshold as E07-T4) -- "nie während Fahrt!" (never while
 * driving): the banner simply doesn't render at all while moving, so there
 * is nothing to accidentally tap/trigger mid-drive either.
 *
 * Deliberately renders `null` (no DOM) whenever gating fails -- safe to
 * mount unconditionally in `App.tsx`, same contract as `ResumePrompt.tsx`.
 */
import React from 'react';
import { usePwaStore } from './pwaStore.js';
import { shouldPromptReload } from './reloadGate.js';
import { useDriveLockStore } from '../drive/driveLockStore.js';

export default function UpdatePrompt(): React.ReactElement | null {
  const updateAvailable = usePwaStore((state) => state.updateAvailable);
  const speedMps = usePwaStore((state) => state.speedMps);
  const reloadNow = usePwaStore((state) => state.reloadNow);
  const thresholdKmh = useDriveLockStore((state) => state.thresholdKmh);

  if (!shouldPromptReload(speedMps, updateAvailable, thresholdKmh)) {
    return null;
  }

  return (
    <div
      className="fixed bottom-4 left-1/2 -translate-x-1/2 z-40 w-[min(90vw,22rem)] rounded-xl bg-white/95 dark:bg-slate-800/95 shadow-2xl p-3 text-sm text-slate-800 dark:text-slate-100 flex items-center gap-3"
      data-testid="update-prompt"
      role="status"
    >
      <p className="flex-1">Update verfügbar.</p>
      <button
        type="button"
        onClick={reloadNow}
        className="px-3 py-2 rounded-md bg-blue-600 text-white text-sm font-medium"
        data-testid="update-reload-button"
      >
        Neu laden
      </button>
    </div>
  );
}
