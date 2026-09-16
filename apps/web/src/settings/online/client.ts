/**
 * Der Zugang zu den Online-Diensten vom Browser aus.
 *
 * Wie überall im Web-Client wird die URL aus `import.meta.env.BASE_URL`
 * gebaut — unter Ingress sitzt die App nicht auf `/`.
 *
 * ─── ZWEI SEHR UNTERSCHIEDLICHE AUFRUFE ─────────────────────────────────────
 * `fetchOnlineStatus` fragt nur den Kern und ruft NICHT nach draußen. Er darf
 * deshalb beim Öffnen der Klappe laufen.
 *
 * `starteDiagnose` verlässt das Haus. Er läuft nur auf Knopfdruck, und er
 * wirft nicht: ein Fehler ist hier eine Auskunft, kein Abbruch — genau dafür
 * gibt es die Prüfung.
 */

/** Wie lange auf die Prüfung gewartet wird. Sie ruft bis zu sechs Adressen
 *  nacheinander, jede mit acht Sekunden Grenze. */
const DIAGNOSE_TIMEOUT_MS = 60_000;
const STATUS_TIMEOUT_MS = 5_000;

export interface DiagnoseZeile {
  dienst: string;
  url: string;
  status: number | null;
  dauer_ms: number;
  befund: string;
  schluessel?: string | null;
  eintraege?: number;
  verworfen?: number;
  beispiel?: { titel: string; lat: number | null; lon: number | null };
}

export interface OnlineStatus {
  aktiv: boolean;
  hinweis: string;
  dienste: Array<{ name: string; beschreibung: string; schluessel_noetig: boolean }>;
}

/** Was es gibt, ohne etwas zu rufen. `null`, wenn der Kern nicht antwortet. */
export async function fetchOnlineStatus(): Promise<OnlineStatus | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), STATUS_TIMEOUT_MS);
  try {
    const response = await fetch(`${import.meta.env.BASE_URL}api/v1/online/status`, {
      signal: controller.signal,
    });
    if (!response.ok) return null;
    const body = (await response.json()) as { data?: OnlineStatus };
    return body?.data ?? null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

export type DiagnoseErgebnis =
  | { urteil: string; zeilen: DiagnoseZeile[] }
  | { fehler: string };

/**
 * Stößt die Prüfung an.
 *
 * Wirft NIE. Ein abgelehnter Aufruf (Dienste aus) und ein Netzfehler sind
 * beides Auskünfte, die der Betreiber lesen soll — nicht Ausnahmen, die
 * irgendwo verschwinden.
 */
export async function starteDiagnose(strasse?: string): Promise<DiagnoseErgebnis> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), DIAGNOSE_TIMEOUT_MS);
  try {
    const response = await fetch(`${import.meta.env.BASE_URL}api/v1/online/diagnose`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(strasse ? { strasse } : {}),
      signal: controller.signal,
    });
    const body = (await response.json()) as {
      data?: { urteil: string; zeilen: DiagnoseZeile[] };
      error?: { message?: string };
    };
    if (!response.ok) {
      // Die Meldung des Kerns sagt bereits, wo der Schalter sitzt. Sie hier
      // durch etwas Eigenes zu ersetzen hiesse, sie zu verlieren.
      return {
        fehler: body?.error?.message ?? `Die Prüfung antwortete mit Status ${response.status}.`,
      };
    }
    if (!body?.data || !Array.isArray(body.data.zeilen)) {
      return { fehler: 'Die Antwort der Prüfung hatte nicht die erwartete Form.' };
    }
    return body.data;
  } catch (err) {
    const abgebrochen = (err as Error)?.name === 'AbortError';
    return {
      fehler: abgebrochen
        ? 'Die Prüfung hat zu lange gedauert und wurde abgebrochen.'
        : `Die Prüfung war nicht erreichbar: ${(err as Error)?.message ?? 'unbekannter Fehler'}.`,
    };
  } finally {
    clearTimeout(timer);
  }
}
