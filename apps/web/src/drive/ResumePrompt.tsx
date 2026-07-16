/**
 * W-19 reload-recovery prompt (E04-T5): "Navigation fortsetzen?" -- runs the
 * boot check once on mount (`resume.ts#checkResumeOnLoad`) and, when it finds
 * something to resume, shows a small one-click confirmation instead of
 * silently jumping into full-screen drive mode. See `resume.ts`'s doc
 * comment for the two cases ("already navigating" vs. "Core restarted, route
 * recovered from cache") this single prompt covers.
 */

import React, { useCallback, useEffect, useState } from 'react';
import { startNavigation, NavigationApiError } from './client.js';
import { useNavStore } from './navStore.js';
import { useProfileStore } from '../profiles/store.js';
import { checkResumeOnLoad } from './resume.js';

export default function ResumePrompt(): React.ReactElement | null {
  const pendingResume = useNavStore((state) => state.pendingResume);
  const setNavState = useNavStore((state) => state.setNavState);
  const acknowledgeResume = useNavStore((state) => state.acknowledgeResume);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void checkResumeOnLoad();
    // Only ever needs to run once on mount.
  }, []);

  const handleResume = useCallback(async () => {
    if (!pendingResume) return;
    setBusy(true);
    setError(null);
    try {
      if (pendingResume.kind === 'active') {
        // Already navigating on the Core -- just promote the snapshot into
        // the live store; the WS will corroborate it on the next tick anyway.
        setNavState(pendingResume.state);
      } else {
        const activeProfile = useProfileStore.getState().activeProfile;
        const state = await startNavigation({
          route_id: pendingResume.route_id,
          destination: pendingResume.destination,
          ...(activeProfile ? { reroute: { profile_id: activeProfile.id } } : {}),
        });
        setNavState(state);
      }
      acknowledgeResume();
    } catch (err) {
      setError(
        err instanceof NavigationApiError ? err.message : 'Navigation konnte nicht fortgesetzt werden.',
      );
    } finally {
      setBusy(false);
    }
  }, [pendingResume, setNavState, acknowledgeResume]);

  const handleDismiss = useCallback(() => {
    acknowledgeResume();
  }, [acknowledgeResume]);

  if (!pendingResume) return null;

  const destinationName =
    pendingResume.kind === 'recovered' ? pendingResume.destination?.name : pendingResume.state.destination?.name;

  return (
    <div
      className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 z-30 w-[min(90vw,24rem)] rounded-xl bg-white/95 dark:bg-slate-800/95 shadow-2xl p-4 text-sm text-slate-800 dark:text-slate-100 space-y-3"
      data-testid="resume-prompt"
    >
      <h2 className="font-semibold">Navigation fortsetzen?</h2>
      <p className="text-xs text-slate-500 dark:text-slate-400">
        {destinationName
          ? `Es läuft noch eine Navigation nach ${destinationName}.`
          : 'Es läuft noch eine Navigation.'}
      </p>
      {error && (
        <p className="text-xs text-red-700 dark:text-red-300" data-testid="resume-prompt-error">
          {error}
        </p>
      )}
      <div className="flex gap-2">
        <button
          type="button"
          onClick={() => void handleResume()}
          disabled={busy}
          className="flex-1 px-3 py-2 rounded-md bg-blue-600 text-white text-sm font-medium disabled:opacity-50"
          data-testid="resume-navigation-button"
        >
          {busy ? 'Wird fortgesetzt…' : 'Fortsetzen'}
        </button>
        <button
          type="button"
          onClick={handleDismiss}
          disabled={busy}
          className="px-3 py-2 rounded-md border border-slate-300 dark:border-slate-600 text-xs disabled:opacity-50"
          data-testid="resume-dismiss-button"
        >
          Verwerfen
        </button>
      </div>
    </div>
  );
}
