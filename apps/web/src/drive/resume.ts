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

/**
 * Ob diese Seite durch ein echtes NEULADEN entstanden ist -- und nicht
 * einfach dadurch, dass sie neu geoeffnet wurde.
 *
 * ─── WARUM DAS DEN UNTERSCHIED MACHT ────────────────────────────────────────
 * Gemeldet: „Ich habe die Navigation direkt in Yapaia Go gestartet, wechsle
 * dann zum Dashboard und sehe dort keine Daten. Wenn ich wieder zurueck zu
 * Yapaia Go gehe werde ich gefragt ob ich die Navigation fortsetzen moechte.
 * Es sieht aus als ob die Navigation gestoppt wird."
 *
 * Sie wird NICHT gestoppt -- die Frage ist der Beweis dafuer: sie erscheint
 * nur, wenn der Core `navigating`/`off_route`/`paused` meldet. Home Assistant
 * wirft aber beim Wechsel auf ein anderes Dashboard den Ingress-Rahmen weg
 * und baut ihn beim Zurueckkommen neu auf. Fuer die App ist das ein frischer
 * Start, und sie stellt pflichtschuldig die Frage aus W-19 -- bei jedem
 * Wechsel aufs Neue. Was als Sicherheitsabfrage gedacht war, liest sich damit
 * als „deine Fahrt wurde abgebrochen".
 *
 * Der Browser weiss, welcher Fall vorliegt: ein Neuladen meldet sich als
 * `reload`, ein neu geoeffneter Rahmen als `navigate`. Nur beim Neuladen wird
 * gefragt -- das ist genau der Fall, den W-19 meint („Tab-Absturz/Neuladen").
 *
 * Im Zweifel (kein Eintrag, alte Browser) wird GEFRAGT: lieber eine Frage zu
 * viel als ungefragt in die Vollbild-Fahransicht springen.
 */
export function istNeuladen(): boolean {
  try {
    const eintrag = performance.getEntriesByType('navigation')[0] as
      | PerformanceNavigationTiming
      | undefined;
    return eintrag?.type !== 'navigate';
  } catch {
    return true;
  }
}

export async function checkResumeOnLoad(
  neuladen: () => boolean = istNeuladen,
): Promise<void> {
  const { setPendingResume, acknowledgeResume, setNavState } = useNavStore.getState();
  try {
    const { navState, recoveredRoute } = await getNavigationState();
    if (ACTIVE_STATUSES.has(navState.status)) {
      if (!neuladen()) {
        // Die Fahrt laeuft und nichts ist verlorengegangen -- die Seite wurde
        // nur neu geoeffnet. Also einsteigen statt fragen.
        setNavState(navState);
        acknowledgeResume();
        return;
      }
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
