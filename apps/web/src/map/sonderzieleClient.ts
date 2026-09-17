/**
 * Die Sonderziele holen, die in keiner Kachel stehen können.
 *
 * ─── WARUM DAS EINE EIGENE DATEI IST ────────────────────────────────────────
 * Damit sie ohne Browser geprüft werden kann. Die Antwort trägt Felder, die
 * genau dann wichtig werden, wenn etwas fehlt (`ohne_index`, `gekappt`) — und
 * die stillschweigend wegzulassen wäre hier der teuerste Fehler.
 *
 * ─── WAS HIER NICHT AUS DEM KERN IMPORTIERT WIRD ────────────────────────────
 * Nichts. `@yapaia/core` ist aus `apps/web` NICHT auflösbar: der Alias steht
 * in `vitest.config.ts`, aber nicht in `apps/web/vite.config.ts`. Ein solcher
 * Import besteht jeden Test und zerbricht den Browser-Bau. Genau das ist bei
 * den Verkehrsmeldungen passiert.
 */

/** Ein Sonderziel, wie die Karte es zeichnet. */
export interface SonderzielEigenschaften {
  name: string;
  kategorie: string;
  bezeichnung: string;
  symbol: string;
  rang: number;
  adresse?: string;
  ort?: string;
}

export interface SonderzielMerkmal {
  type: 'Feature';
  geometry: { type: 'Point'; coordinates: [number, number] };
  properties: SonderzielEigenschaften;
}

export interface SonderzielBefund {
  indizes: Array<{
    region: string | null;
    datei: string;
    anzahl: number;
    gekappt: boolean;
    fehler?: string;
  }>;
  kategorien: Array<{ kategorie: string; name: string; symbol: string; grund: string }>;
  gekappt: boolean;
  ohne_index: boolean;
}

export interface SonderzieleAntwort {
  type: 'FeatureCollection';
  features: SonderzielMerkmal[];
  befund: SonderzielBefund;
}

export const SONDERZIELE_LEER: SonderzieleAntwort = {
  type: 'FeatureCollection',
  features: [],
  befund: { indizes: [], kategorien: [], gekappt: false, ohne_index: false },
};

/**
 * Prüft eine Antwort, bevor die Karte sie glaubt.
 *
 * ─── WARUM SO MISSTRAUISCH ──────────────────────────────────────────────────
 * Weil ein fehlendes Feld hier NICHT auffällt. Käme `befund` nicht mit, wäre
 * `ohne_index` schlicht `undefined` — und aus „konnte nicht nachsehen" würde
 * lautlos „es gibt hier keine". Das ist der eine Fehler, den diese ganze
 * Änderung vermeiden soll; er darf nicht durch die Hintertür wieder herein.
 */
export function pruefeAntwort(roh: unknown): SonderzieleAntwort {
  if (typeof roh !== 'object' || roh === null) return SONDERZIELE_LEER;
  const o = roh as Record<string, unknown>;
  const features = Array.isArray(o.features) ? o.features : [];
  const befund = (typeof o.befund === 'object' && o.befund !== null ? o.befund : {}) as Record<
    string,
    unknown
  >;

  return {
    type: 'FeatureCollection',
    features: features.filter(istMerkmal),
    befund: {
      indizes: Array.isArray(befund.indizes)
        ? (befund.indizes as SonderzielBefund['indizes'])
        : [],
      kategorien: Array.isArray(befund.kategorien)
        ? (befund.kategorien as SonderzielBefund['kategorien'])
        : [],
      gekappt: befund.gekappt === true,
      // Fehlt das Feld, ist die Lage UNBEKANNT und nicht „alles in Ordnung".
      // Eine fehlende Antwort wie eine leere zu behandeln wäre genau die
      // Verwechslung, gegen die es dieses Feld gibt.
      ohne_index: befund.ohne_index !== false,
    },
  };
}

function istMerkmal(wert: unknown): wert is SonderzielMerkmal {
  if (typeof wert !== 'object' || wert === null) return false;
  const f = wert as Record<string, unknown>;
  const g = f.geometry as Record<string, unknown> | undefined;
  const p = f.properties as Record<string, unknown> | undefined;
  if (!g || !p) return false;
  if (!Array.isArray(g.coordinates) || g.coordinates.length !== 2) return false;
  const [lon, lat] = g.coordinates as unknown[];
  if (typeof lon !== 'number' || typeof lat !== 'number') return false;
  if (!Number.isFinite(lon) || !Number.isFinite(lat)) return false;
  // Ein Symbol, das das Blatt nicht kennt, zeichnet MapLibre als nichts --
  // lautlos. Ohne Namen ist der Punkt gar nicht erst zuzuordnen.
  return typeof p.symbol === 'string' && p.symbol.length > 0;
}

/**
 * Die Adresse einer Schnittstelle — RELATIV zum ausgelieferten Verzeichnis.
 *
 * ─── DER FEHLER, DEN DAS BEHEBT ─────────────────────────────────────────────
 * Hier stand `fetch("/api/v1/map/sonderziele")`. Der fuehrende Schraegstrich
 * ist eine Adresse ab der DOMAINWURZEL -- und genau die gibt es unter Home
 * Assistant Ingress nicht: dort laeuft Yapaia unter
 *
 *     /api/hassio_ingress/<token>/
 *
 * Eine Anfrage an `/api/v1/...` verlaesst dieses Verzeichnis und landet bei
 * Home Assistant selbst. Die Entsorgungsstationen waeren also auf jedem
 * Ingress-Zugang lautlos verschwunden -- und der Betreiber benutzt
 * ausschliesslich Ingress.
 *
 * Aufgefallen ist es `subpath.spec.ts`, das jede einzelne Anfrage darauf
 * prueft, ob sie unter dem Ingress-Pfad bleibt. Dass dieselbe Fehlerklasse
 * schon einmal die Lovelace-Karte zerlegt hat, macht es nicht besser.
 *
 * `import.meta.env.BASE_URL` ist der Weg, den jedes andere Client-Modul in
 * dieser Anwendung geht (`routing/client.ts`, `profiles/client.ts`,
 * `online/verkehrClient.ts` und so fort). Der Pfad darf dabei KEINEN
 * fuehrenden Schraegstrich haben, sonst ist die Ersetzung wirkungslos.
 */
function apiUrl(path: string): string {
  return `${import.meta.env.BASE_URL}${path}`;
}

/** Holt die Sonderziele vom Kern. */
export async function holeSonderziele(): Promise<SonderzieleAntwort> {
  const antwort = await fetch(apiUrl('api/v1/map/sonderziele'));
  if (!antwort.ok) throw new Error(`Sonderziele: HTTP ${antwort.status}`);
  return pruefeAntwort(await antwort.json());
}
