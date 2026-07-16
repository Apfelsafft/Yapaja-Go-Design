/**
 * Profile-change-during-navigation reroute coupling (E06-T3), UI half.
 * Backend: `apps/core/src/navigation/service.ts` -- `event/profile_changed`
 * during `navigating`/`paused` publishes `event/profile_change_pending` when a
 * UI client is connected (see `apps/web/src/drive/navStore.ts`'s WS handler,
 * which stores it as `pendingProfileChange`); a headless (no client) change
 * skips straight to the reroute, so no banner ever appears for it.
 *
 * Two independent banners, both driven off the nav store:
 *  - Confirmation ("Mit '‹name›' neu berechnen?" Ja/Abbrechen), tasks/E06 spec
 *    text verbatim. "Ja" -> `POST /navigation/profile_change/confirm`.
 *    "Abbrechen" -> reactivates the PREVIOUS profile (the same
 *    `PUT /profiles/{id}/activate` any other activation uses) -- the core
 *    recognises reactivating the profile the current route was already
 *    computed for as a no-op (no reroute), so this restores the exact prior
 *    state with zero extra logic here.
 *  - Warning (advisory, docs/03 §2): shown once `route/updated`'s
 *    `duration_warning_pct` arrives -- the reroute already applied by then,
 *    this is informational only, dismissible.
 *
 * Mounted unconditionally in `DriveOverlay.tsx` (like `ResumePrompt`); stays
 * hidden outside an active drive via the same `isDriveActive` gate
 * `ManeuverPanel`/`DriveOverlay` already use.
 */

import React, { useCallback, useState } from 'react';
import { useNavState, useNavStore } from '../drive/navStore.js';
import { isDriveActive } from '../drive/ManeuverPanel.js';
import { confirmProfileChangeReroute } from '../drive/client.js';
import { useProfileStore } from './store.js';

export default function ProfileChangeBanner(): React.ReactElement | null {
  const navState = useNavState();
  const pending = useNavStore((state) => state.pendingProfileChange);
  const warning = useNavStore((state) => state.profileChangeWarning);
  const setPendingProfileChange = useNavStore((state) => state.setPendingProfileChange);
  const setProfileChangeWarning = useNavStore((state) => state.setProfileChangeWarning);
  const activateProfile = useProfileStore((state) => state.activateProfile);
  const [isBusy, setIsBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleConfirm = useCallback(async () => {
    setIsBusy(true);
    setError(null);
    try {
      await confirmProfileChangeReroute();
      // Optimistic dismiss -- `route/updated` will also clear this once the
      // reroute actually lands, but the banner shouldn't linger until then.
      setPendingProfileChange(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Neuberechnung fehlgeschlagen.');
    } finally {
      setIsBusy(false);
    }
  }, [setPendingProfileChange]);

  const handleCancel = useCallback(async () => {
    if (!pending) return;
    setIsBusy(true);
    setError(null);
    try {
      await activateProfile(pending.previous_profile_id);
      setPendingProfileChange(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Vorheriges Profil konnte nicht reaktiviert werden.');
    } finally {
      setIsBusy(false);
    }
  }, [pending, activateProfile, setPendingProfileChange]);

  const handleDismissWarning = useCallback(
    () => setProfileChangeWarning(null),
    [setProfileChangeWarning],
  );

  if (!isDriveActive(navState?.status)) return null;
  if (!pending && !warning) return null;

  return (
    <div className="fixed bottom-24 left-1/2 -translate-x-1/2 z-30 w-[min(92vw,26rem)] space-y-2 pointer-events-none">
      {pending && (
        <div
          className="pointer-events-auto rounded-xl bg-white dark:bg-slate-800 shadow-2xl border border-slate-200 dark:border-slate-700 p-4 space-y-3"
          data-testid="profile-change-confirm-banner"
        >
          <p className="text-sm text-slate-800 dark:text-slate-100" data-testid="profile-change-confirm-text">
            Mit &apos;{pending.profile_name}&apos; neu berechnen?
          </p>
          {error && (
            <p className="text-xs text-red-600 dark:text-red-400" data-testid="profile-change-confirm-error">
              {error}
            </p>
          )}
          <div className="flex gap-2 justify-end">
            <button
              type="button"
              onClick={() => void handleCancel()}
              disabled={isBusy}
              data-testid="profile-change-confirm-cancel"
              className="px-3 py-1.5 rounded-md border border-slate-300 dark:border-slate-600 text-sm text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-700 disabled:opacity-50"
            >
              Abbrechen
            </button>
            <button
              type="button"
              onClick={() => void handleConfirm()}
              disabled={isBusy}
              data-testid="profile-change-confirm-yes"
              className="px-3 py-1.5 rounded-md bg-blue-600 text-white text-sm font-medium hover:bg-blue-700 disabled:opacity-50"
            >
              Ja
            </button>
          </div>
        </div>
      )}

      {warning && (
        <div
          className="pointer-events-auto rounded-xl bg-amber-50 dark:bg-amber-900/90 border border-amber-300 dark:border-amber-700 shadow-xl p-4 flex items-start gap-3"
          data-testid="profile-change-warning-banner"
        >
          <span className="text-lg" aria-hidden="true">
            ⚠️
          </span>
          <p className="flex-1 text-sm text-amber-900 dark:text-amber-100">
            Neue Route ist ca. {warning.pct}&nbsp;% länger als zuvor.
          </p>
          <button
            type="button"
            onClick={handleDismissWarning}
            data-testid="profile-change-warning-dismiss"
            className="text-amber-700 dark:text-amber-200 hover:text-amber-900 dark:hover:text-amber-50 text-sm font-medium"
          >
            OK
          </button>
        </div>
      )}
    </div>
  );
}
