/**
 * Online-Infos zu einem Ort vom Kern holen (`POST /api/v1/online/ort`).
 *
 * POST, obwohl nur gelesen wird -- dieselbe Begründung wie bei
 * `online/verkehrClient.ts`: der Aufruf verlässt hinter dem Kern das Haus,
 * und ein GET würde von Browsern und Dashboards gern ungefragt geholt.
 *
 * Wirft nie: kein Netz oder ein abgeschalteter Online-Teil sind Auskünfte,
 * keine Fehler. Die Ortskarte zeigt dann, was offline bekannt ist.
 */

export interface OsmAngaben {
  website?: string;
  telefon?: string;
  email?: string;
  oeffnungszeiten?: string;
  gebuehr?: string;
  beschreibung?: string;
  merkmale: string[];
}

export interface OrtBild {
  daten: string;
  quelle: string;
  art: 'artikel' | 'umgebung';
}

export interface OrtInfo {
  osm: OsmAngaben | null;
  wikipedia: { titel: string; auszug: string; url: string } | null;
  bilder: OrtBild[];
}

export type OrtErgebnis =
  | { art: 'ok'; info: OrtInfo }
  /** Online ist in der Add-on-Konfiguration abgeschaltet. */
  | { art: 'aus' }
  | { art: 'fehler'; text: string };

/** Overpass, Wikipedia und Commons nacheinander, jeder mit eigener Grenze. */
const ZEITGRENZE_MS = 25_000;

export async function holeOrtInfo(anfrage: {
  lat: number;
  lon: number;
  name?: string | null;
}): Promise<OrtErgebnis> {
  const abbruch = new AbortController();
  const wecker = setTimeout(() => abbruch.abort(), ZEITGRENZE_MS);
  try {
    const antwort = await fetch(`${import.meta.env.BASE_URL}api/v1/online/ort`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        lat: anfrage.lat,
        lon: anfrage.lon,
        ...(anfrage.name ? { name: anfrage.name } : {}),
      }),
      signal: abbruch.signal,
    });
    if (antwort.status === 409) return { art: 'aus' };
    if (!antwort.ok) return { art: 'fehler', text: `Der Kern antwortete mit ${antwort.status}.` };
    const body = (await antwort.json()) as { data?: OrtInfo };
    if (!body?.data) return { art: 'fehler', text: 'Leere Antwort vom Kern.' };
    return { art: 'ok', info: body.data };
  } catch {
    return { art: 'fehler', text: 'Keine Verbindung.' };
  } finally {
    clearTimeout(wecker);
  }
}
