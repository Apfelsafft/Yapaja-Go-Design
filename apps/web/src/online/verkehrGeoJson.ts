/**
 * Aus Verkehrsmeldungen werden Kartenpunkte.
 *
 * ─── WARUM DAS EINE EIGENE, REINE FUNKTION IST ──────────────────────────────
 * Weil hier die Entscheidungen liegen, und Entscheidungen gehören geprüft. In
 * einer React-Komponente mit einer MapLibre-Instanz daneben wären sie nur
 * noch im Browser zu erreichen — und was nur im Browser zu erreichen ist,
 * wird in diesem Projekt erfahrungsgemäß nicht geprüft.
 *
 * ─── DIE DREI ENTSCHEIDUNGEN ────────────────────────────────────────────────
 *
 * 1. WAS KEINEN ORT HAT, KOMMT NICHT AUF DIE KARTE. Der Kern liefert zwar
 *    nur noch verortete Meldungen (`online/verkehr.ts` filtert), aber diese
 *    Funktion verlässt sich nicht darauf: sie bekommt ihre Daten über das
 *    Netz, und was über das Netz kommt, ist keine Zusicherung.
 *
 * 2. WAS KEIN SYMBOL HAT, KOMMT AUCH NICHT DRAUF. Ein Ersatzzeichen wäre
 *    hier falsch — ein Punkt, den niemand deuten kann, kostet während der
 *    Fahrt Aufmerksamkeit und gibt nichts dafür. Den Namen des Bildes
 *    liefert der Kern mit; diese Datei prüft nur, dass einer da ist.
 *
 * 3. DIE ZAHL DER WEGGELASSENEN WIRD ZURÜCKGEGEBEN. Sie verschwinden nicht
 *    einfach. Eine Karte, auf der drei von zwanzig Meldungen fehlen, sieht
 *    genauso aus wie eine, auf der alle stehen — und das ist genau die
 *    Verwechslung, die dieses Projekt seit Monaten verfolgt.
 */

/**
 * Was von einer Meldung gebraucht wird — mehr nicht.
 *
 * `symbol` kommt VOM KERN mit. Es hier selbst aus der Art abzuleiten wäre
 * eine zweite Kopie der Zuordnung gewesen — und ein Versuch, sie per
 * `import` aus dem Kern zu holen, hätte alle Tests bestanden und den
 * Browser-Bau gebrochen: `@yapaia/core` steht in der Auflösung von
 * `vitest.config.ts`, aber nicht in der von `apps/web/vite.config.ts`.
 */
export interface KartenMeldung {
  id: string;
  art: string;
  strasse: string;
  titel: string;
  beschreibung: string;
  lat: number | null;
  lon: number | null;
  symbol: string | null;
}

export interface VerkehrPunkte {
  geojson: {
    type: 'FeatureCollection';
    features: Array<{
      type: 'Feature';
      id?: string;
      geometry: { type: 'Point'; coordinates: [number, number] };
      properties: Record<string, string>;
    }>;
  };
  /** Meldungen, die nicht gezeichnet werden konnten — und warum. */
  weggelassen: { ohneOrt: number; ohneSymbol: number };
}

/** Ein Punkt liegt auf der Erde, oder er liegt nicht auf der Erde. */
function istOrt(lat: number | null, lon: number | null): lat is number {
  return (
    typeof lat === 'number' &&
    typeof lon === 'number' &&
    Number.isFinite(lat) &&
    Number.isFinite(lon) &&
    lat >= -90 &&
    lat <= 90 &&
    lon >= -180 &&
    lon <= 180 &&
    // 0/0 liegt im Golf von Guinea. Es ist der Wert, den eine fehlgeschlagene
    // Umwandlung hinterlässt, und er sähe auf der Karte wie eine echte
    // Meldung aus — nur eben 2000 km vor der Küste Westafrikas.
    !(lat === 0 && lon === 0)
  );
}

export function verkehrGeoJson(meldungen: readonly KartenMeldung[]): VerkehrPunkte {
  const features: VerkehrPunkte['geojson']['features'] = [];
  let ohneOrt = 0;
  let ohneSymbol = 0;

  for (const m of meldungen) {
    if (!istOrt(m.lat, m.lon)) {
      ohneOrt += 1;
      continue;
    }
    const symbol = m.symbol;
    if (typeof symbol !== 'string' || symbol.length === 0) {
      ohneSymbol += 1;
      continue;
    }
    features.push({
      type: 'Feature',
      id: m.id,
      geometry: { type: 'Point', coordinates: [m.lon as number, m.lat] },
      properties: {
        id: m.id,
        symbol,
        art: m.art,
        strasse: m.strasse,
        titel: m.titel,
        beschreibung: m.beschreibung,
      },
    });
  }

  return {
    geojson: { type: 'FeatureCollection', features },
    weggelassen: { ohneOrt, ohneSymbol },
  };
}
