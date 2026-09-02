/**
 * Fetch helpers for the region manager (E01-T5): installed regions, the
 * downloadable-regions catalog, starting/polling a download job, and
 * deleting an installed region.
 *
 * Like `apps/web/src/map/regions.ts` and `apps/web/src/map/styleClient.ts`,
 * every URL is built from `import.meta.env.BASE_URL` (never a hardcoded
 * `/api/...` path) so this keeps working under an ingress sub-path (W-15).
 */

export interface InstalledRegion {
  region: string;
  size_bytes: number;
  bounds: [number, number, number, number]; // [minLon, minLat, maxLon, maxLat]
  minzoom: number;
  maxzoom: number;
  tile_type: string;
  compression: string;
}

/** Wie aufwändig der Kachelbau ist — steuert nur die Formulierung. */
export type BuildEffort = 'small' | 'large';

export interface CatalogRegion {
  id: string;
  name: string;
  /** Fertige `.pmtiles`-Datei zum Herunterladen. OPTIONAL: die
   *  mitgelieferten Einträge haben KEINE (siehe
   *  `apps/core/src/map/regions/catalog.ts`). Fehlt sie, wird die Region
   *  aus dem OSM-Extrakt gebaut statt geladen — und dann darf die
   *  Oberfläche keinen „Herunterladen"-Knopf anbieten. */
  url?: string;
  /** OSM-Extrakt, aus dem gebaut wird. */
  pbfUrl?: string;
  sizeBytes: number;
  bounds: [number, number, number, number];
  sha256?: string;
  buildEffort?: BuildEffort;
  /** Freitext-Hinweis aus dem Katalog (deutsch). */
  note?: string;
  installed: boolean;
}

export type JobStatus = 'queued' | 'running' | 'done' | 'error';

export interface JobErrorInfo {
  code: string;
  message: string;
  details?: Record<string, unknown>;
}

export interface JobSnapshot {
  id: string;
  status: JobStatus;
  progress: number;
  bytes: number;
  totalBytes: number | null;
  error: JobErrorInfo | null;
  /** Statuszeile für Jobs ohne messbaren Fortschritt (Kachelbau, B-04).
   *  Ein Prozentwert wäre dort erfunden — planetilers Ausgabe lässt sich
   *  nicht versionsstabil in eine Zahl übersetzen. */
  note?: string;
}

interface ApiErrorBody {
  error: { code: string; message: string; details?: Record<string, unknown> };
}

/** Thrown by the mutating calls (startDownload/deleteRegion) below, carrying
 *  the core's unified `{error:{code,message,details?}}` shape so callers
 *  can render a specific message for e.g. INSUFFICIENT_SPACE / LAST_REGION. */
export class RegionApiError extends Error {
  code: string;
  details?: Record<string, unknown>;

  constructor(code: string, message: string, details?: Record<string, unknown>) {
    super(message);
    this.name = 'RegionApiError';
    this.code = code;
    this.details = details;
  }
}

function apiUrl(path: string): string {
  return `${import.meta.env.BASE_URL}${path}`;
}

async function toApiError(response: Response): Promise<RegionApiError> {
  try {
    const body = (await response.json()) as ApiErrorBody;
    if (body?.error?.code && body.error.message) {
      return new RegionApiError(body.error.code, body.error.message, body.error.details);
    }
  } catch {
    // Body wasn't the expected error shape; fall through to a generic error.
  }
  return new RegionApiError('UNKNOWN', `Request failed with status ${response.status}`);
}

/** Installed regions. Returns [] (never throws) on network/parse failure. */
export async function fetchInstalledRegions(): Promise<InstalledRegion[]> {
  try {
    const response = await fetch(apiUrl('api/v1/map/regions'));
    if (!response.ok) {
      return [];
    }
    const body = (await response.json()) as { data: InstalledRegion[] };
    return Array.isArray(body?.data) ? body.data : [];
  } catch {
    return [];
  }
}

/** Downloadable-regions catalog (+ `installed` flag per entry). Returns []
 *  (never throws) on network/parse failure. */
export async function fetchCatalog(): Promise<CatalogRegion[]> {
  try {
    const response = await fetch(apiUrl('api/v1/map/regions/catalog'));
    if (!response.ok) {
      return [];
    }
    const body = (await response.json()) as { data: CatalogRegion[] };
    return Array.isArray(body?.data) ? body.data : [];
  } catch {
    return [];
  }
}

/** Starts a download job for `regionId`. Throws RegionApiError on any
 *  non-2xx response (e.g. 409 INSUFFICIENT_SPACE / ALREADY_INSTALLED, 404
 *  unknown region), or a plain Error on a network failure. */
export async function startDownload(regionId: string): Promise<string> {
  const response = await fetch(apiUrl('api/v1/map/regions'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ region_id: regionId }),
  });
  if (!response.ok) {
    throw await toApiError(response);
  }
  const body = (await response.json()) as { job_id: string };
  return body.job_id;
}

/** Startet einen KACHELBAU für `regionId` (B-04) — der Gegenpart zu
 *  `startDownload` für Regionen, für die es keine fertige Datei gibt.
 *  Wirft RegionApiError bei 409 (INSUFFICIENT_SPACE / INSUFFICIENT_MEMORY /
 *  ALREADY_INSTALLED / NO_BUILD_SOURCE) oder 404. */
export async function startBuild(regionId: string): Promise<string> {
  const response = await fetch(
    apiUrl(`api/v1/map/regions/${encodeURIComponent(regionId)}/build`),
    { method: 'POST' },
  );
  if (!response.ok) {
    throw await toApiError(response);
  }
  const body = (await response.json()) as { job_id: string };
  return body.job_id;
}

/** Fetches one job's current status. Returns null (never throws) on
 *  network/parse failure or an unknown job id, so pollers can just skip a
 *  beat rather than crash. */
export async function fetchJob(jobId: string): Promise<JobSnapshot | null> {
  try {
    const response = await fetch(apiUrl(`api/v1/jobs/${encodeURIComponent(jobId)}`));
    if (!response.ok) {
      return null;
    }
    const body = (await response.json()) as { data: JobSnapshot };
    return body.data ?? null;
  } catch {
    return null;
  }
}

/** Deletes an installed region. Throws RegionApiError on any non-2xx
 *  response (e.g. 409 LAST_REGION, 404 unknown region). */
export async function deleteRegion(regionId: string): Promise<void> {
  const response = await fetch(apiUrl(`api/v1/map/regions/${encodeURIComponent(regionId)}`), {
    method: 'DELETE',
  });
  if (!response.ok) {
    throw await toApiError(response);
  }
}
