/**
 * „Unterwegs finden": die nächste Tankstelle, der nächste Stellplatz … VORAUS
 * auf der Route.
 *
 * ─── WOFÜR ──────────────────────────────────────────────────────────────────
 * Stufe 1 des Sprach-Copiloten (`docs/ideen-ki.md`, Idee 1). Der Copilot soll
 * später auf „Wir brauchen Diesel" mit einer Tankstelle antworten, an der man
 * vorbeikommt. Genau diese Suche braucht er als Werkzeug — und sie ist auch
 * ohne KI nützlich: ein Tipp im Fahrtmenü statt Tippen in ein gesperrtes
 * Suchfeld.
 *
 * Die Lage-Entscheidung (voraus, Korridor, ohne Route Umkreis) steht in
 * `bord/entlangRoute.ts` und wird hier nicht wiederholt; die Bordsensoren
 * benutzen dieselbe.
 *
 * ─── WARUM EINE FESTE LISTE ─────────────────────────────────────────────────
 * Nur Kategorien, die man UNTERWEGS als Zwischenstopp anfährt. „Apotheke"
 * oder „Krankenhaus" sucht man über die normale Suche mit Namen und Adresse;
 * „Sehenswürdigkeit voraus" ist Sache des Reise-Erzählers (Idee 3).
 */

import { LiteIndexReader } from './lite/reader.js';
import { listLiteSearchDbFiles, resolveLiteSearchDir } from './lite/paths.js';
import { naechsteStationen, type Fundstelle, type Kandidat } from '../bord/entlangRoute.js';
import type { RouteGeometry } from '../navigation/mapMatching.js';
import { type UnterwegsKategorie } from '@yapaia/shared';

export { UNTERWEGS_KATEGORIEN, unterwegsKategorie, type UnterwegsKategorie } from '@yapaia/shared';

/** Höchstens so viele Einträge je Kategorie und Index. Deutschland hat ~15 000 Tankstellen. */
export const HOECHSTENS_JE_INDEX = 40_000;

/**
 * Alle Einträge einer Kategorie aus allen installierten Suchindizes.
 *
 * Ein unbenannter Eintrag heißt wie seine Kategorie — ein Parkplatz ohne
 * Namen ist immer noch ein Parkplatz.
 */
export function leseKandidaten(kategorie: UnterwegsKategorie, dateien?: readonly string[]): Kandidat[] {
  const pfade = dateien ?? listLiteSearchDbFiles(resolveLiteSearchDir());
  const raus: Kandidat[] = [];
  for (const pfad of pfade) {
    const leser = new LiteIndexReader(pfad);
    try {
      for (const z of leser.byCategories([kategorie.id], HOECHSTENS_JE_INDEX)) {
        if (!Number.isFinite(z.lat) || !Number.isFinite(z.lon)) continue;
        const name = typeof z.name === 'string' && z.name.trim() ? z.name.trim() : kategorie.name;
        raus.push({ name, lat: z.lat, lon: z.lon });
      }
    } catch {
      // Ein kaputter Index nimmt nicht die anderen mit. Welcher es ist, sagt
      // die Installationsprüfung; hier zählt, dass die übrigen antworten.
    } finally {
      leser.close();
    }
  }
  return raus;
}

export interface UnterwegsErgebnis {
  kategorie: UnterwegsKategorie;
  /** Worauf sich „nächste" bezieht: die Route voraus, die Position, oder nichts. */
  bezug: 'route' | 'position' | 'keiner';
  treffer: Fundstelle[];
}

export function sucheUnterwegs(
  kategorie: UnterwegsKategorie,
  kandidaten: readonly Kandidat[],
  ort: {
    route: { geom: RouteGeometry; progressM: number } | null;
    position: { lat: number; lon: number } | null;
  },
  anzahl = 3,
): UnterwegsErgebnis {
  const bezug = ort.route ? 'route' : ort.position ? 'position' : 'keiner';
  return { kategorie, bezug, treffer: naechsteStationen(kandidaten, ort, anzahl) };
}
