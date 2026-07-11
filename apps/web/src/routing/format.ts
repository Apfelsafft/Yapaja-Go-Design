/**
 * Single source of truth for how route distance/duration/ETA are formatted
 * in the UI (E03-T3 plausibility requirement: the displayed distance/duration
 * must equal the API's `Route.distance_m`/`duration_s` -- routed through
 * exactly ONE formatter, never re-computed ad hoc in a component).
 */

/** `distance_m` -> localized string, e.g. "850 m" or "12,3 km". */
export function formatDistance(meters: number): string {
  if (!Number.isFinite(meters) || meters < 1000) {
    return `${Math.round(meters)} m`;
  }
  const km = meters / 1000;
  return `${km.toFixed(1).replace('.', ',')} km`;
}

/** `duration_s` -> localized string, e.g. "23 Min" or "1 Std 23 Min". */
export function formatDuration(seconds: number): string {
  const totalMinutes = Math.round(seconds / 60);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours === 0) {
    return `${minutes} Min`;
  }
  return `${hours} Std ${minutes} Min`;
}

/**
 * `duration_s` (from "now") -> localized arrival-time-of-day string, e.g.
 * "14:32". `nowMs` is injected (rather than read from `Date.now()` inside)
 * so this stays deterministically testable.
 */
export function formatEta(nowMs: number, durationS: number): string {
  const eta = new Date(nowMs + durationS * 1000);
  const hh = String(eta.getHours()).padStart(2, '0');
  const mm = String(eta.getMinutes()).padStart(2, '0');
  return `${hh}:${mm}`;
}
