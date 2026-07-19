/**
 * GPS-source fetch helpers for the onboarding wizard's GPS step (E08-T5):
 * lists sources (`GET /api/v1/position/sources`), forces a preferred one
 * (`PUT /api/v1/position/source`, same endpoints `browserSource.ts` already
 * polls/`nav-control`-adjacent code drives), and -- for the `simulator`
 * source specifically -- kicks off a short built-in test drive (`POST
 * /api/v1/simulator/play`) so "wählen+testen (Live-Status)" has something to
 * actually show live status FOR without requiring a real GPS/USB device
 * during onboarding. Live status itself is read from the existing
 * `useGpsSignalState()` hook (`position/gpsSignal.ts`) -- not duplicated here.
 */

export type PositionSourceName = 'gpsd' | 'browser' | 'simulator';

export interface SourceStatus {
  name: PositionSourceName;
  active: boolean;
  lastFixTs: string | null;
}

interface SourcesApiResponse {
  sources: SourceStatus[];
  active: PositionSourceName | null;
  forced: PositionSourceName | null;
}

function apiUrl(path: string): string {
  return `${import.meta.env.BASE_URL}${path}`;
}

/** Lists all registered sources + which is active/forced. Returns a fully
 *  empty snapshot (never throws) on network/parse failure. */
export async function fetchPositionSources(): Promise<SourcesApiResponse> {
  try {
    const response = await fetch(apiUrl('api/v1/position/sources'));
    if (!response.ok) return { sources: [], active: null, forced: null };
    return (await response.json()) as SourcesApiResponse;
  } catch {
    return { sources: [], active: null, forced: null };
  }
}

/** Forces (or, via `'auto'`, releases) the active position source. */
export async function forcePositionSource(source: PositionSourceName | 'auto'): Promise<void> {
  await fetch(apiUrl('api/v1/position/source'), {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ source }),
  });
}

/** Starts a short built-in simulator drive (the `city` GPX fixture, same one
 *  `gps-loss.spec.ts` already exercises) so selecting "simulator" as the GPS
 *  source has real fixes flowing for the live-status indicator to react to. */
export async function startSimulatorTestDrive(): Promise<void> {
  await fetch(apiUrl('api/v1/simulator/play'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ track: { gpxId: 'city' }, speed_factor: 3 }),
  });
}
