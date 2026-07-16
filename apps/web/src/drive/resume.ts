/**
 * W-19 reload-recovery boot check (E04-T5, docs/08 W-19): "App fragt
 * Core-State und bietet 'Navigation fortsetzen?' (Route aus Cache, ein Klick
 * -> navigating)."
 *
 * Runs ONCE at app mount (`ResumePrompt.tsx`), via a single
 * `GET /api/v1/navigation/state` (docs/08 W-19: "NavState + Route via REST,
 * DANN WS" -- REST first, the WS just takes over afterwards). Two cases:
 *
 *  1. The Core is ALREADY navigating/off_route/paused: a tab crash/reload
 *     while the Core process kept running. Nothing was actually lost -- but
 *     E04-T5 explicitly wants a one-click confirmation before the UI jumps
 *     back into full-screen drive mode (3D camera, follow-me) rather than
 *     silently doing it the instant the page loads.
 *  2. The Core restarted: navigation always boots back to `idle` (no ghost
 *     navigation, E04-T1), but the last route is still cached --
 *     `recovered_route` on the same response carries its reference.
 *
 * Either way sets `pendingResume`; the "Navigation fortsetzen?" prompt reads
 * it and resolves it with one click (`ResumePrompt.tsx`). No pending case ->
 * `acknowledgeResume()` immediately, so the Drive UI gate opens right away
 * (nothing to wait for). A failed check fails OPEN (same call) -- a broken
 * reload-recovery check must never block the rest of the app from working.
 */

import { getNavigationState } from './client.js';
import { useNavStore } from './navStore.js';

const ACTIVE_STATUSES = new Set(['navigating', 'off_route', 'paused']);

export async function checkResumeOnLoad(): Promise<void> {
  const { setPendingResume, acknowledgeResume } = useNavStore.getState();
  try {
    const { navState, recoveredRoute } = await getNavigationState();
    if (ACTIVE_STATUSES.has(navState.status)) {
      setPendingResume({ kind: 'active', state: navState });
      return;
    }
    if (recoveredRoute) {
      setPendingResume({
        kind: 'recovered',
        route_id: recoveredRoute.route_id,
        destination: recoveredRoute.destination,
      });
      return;
    }
    acknowledgeResume();
  } catch (err) {
    console.warn('[resume] W-19 reload-recovery check failed, continuing without a prompt:', err);
    acknowledgeResume();
  }
}
