/**
 * Abruf der Installationsprüfung (`GET /api/v1/system/preflight`).
 *
 * Wie überall im Web-Client wird die URL aus `import.meta.env.BASE_URL`
 * gebaut, nie als absoluter `/api/...`-Pfad — sonst bricht der Aufruf unter
 * einem Ingress-Unterpfad (W-15).
 *
 * Der Aufruf ist ABSICHTLICH langsamer als andere: der Server öffnet dabei
 * TCP-Verbindungen zu Valhalla, Photon und gpsd. Deshalb hat er ein eigenes
 * Zeitlimit — hängt der Server selbst, soll die Seite das sagen und nicht
 * unbegrenzt „Prüfe…" anzeigen.
 */

export type PreflightStatus = 'ok' | 'warn' | 'fail';
export type PreflightSeverity = 'required' | 'recommended' | 'optional';

export interface PreflightCheck {
  id: string;
  label: string;
  status: PreflightStatus;
  severity: PreflightSeverity;
  detail: string;
  remedy?: string;
}

export interface PreflightReport {
  status: PreflightStatus;
  summary: string;
  checks: PreflightCheck[];
  checkedAt: string;
}

/** Reichlich bemessen: die Serverseite gibt jeder Netzsonde 1,5 s, und es
 *  sind mehrere. Das hier ist die Notbremse gegen einen hängenden Server,
 *  keine Erwartung an die normale Laufzeit. */
export const PREFLIGHT_TIMEOUT_MS = 15_000;

export async function fetchPreflight(): Promise<PreflightReport> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), PREFLIGHT_TIMEOUT_MS);
  try {
    const response = await fetch(`${import.meta.env.BASE_URL}api/v1/system/preflight`, {
      signal: controller.signal,
    });
    if (!response.ok) {
      throw new Error(`Die Prüfung antwortete mit Status ${response.status}.`);
    }
    const body = (await response.json()) as { data?: PreflightReport };
    if (!body?.data || !Array.isArray(body.data.checks)) {
      throw new Error('Die Antwort der Prüfung hatte nicht die erwartete Form.');
    }
    return body.data;
  } finally {
    clearTimeout(timer);
  }
}
