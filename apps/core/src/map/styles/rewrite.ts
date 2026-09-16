/**
 * Rewrites a style document's vector source URL(s) to point at the active
 * region's actual tile archive before it's served.
 */

import { REGION_SOURCE_ID } from './constants.js';
import type { MapStyleDocument, StyleSource } from './types.js';

/**
 * Builds the relative `pmtiles://` tile URL for a region.
 *
 * Deliberately a *page-relative* URL (`./tiles/<region>.pmtiles`, no leading
 * slash, no origin) rather than a root-relative or absolute one: this style
 * JSON is delivered as plain data (`fetch(...).then(r => r.json())`), not
 * navigated to, so the browser has no "style URL" to resolve relative paths
 * against — the `pmtiles://` protocol handler resolves the remainder
 * against the *page's* location instead (see
 * `apps/web/src/map/regions.ts` `pmtilesUrlForRegion`, which already builds
 * region tile URLs this same way for the same reason). A page-relative URL
 * is the only form that keeps working both at `/` and under an ingress
 * sub-path (W-15) — the core has no notion of that prefix and must not bake
 * one in.
 */
export function tileUrlForRegion(region: string): string {
  return `pmtiles://./tiles/${region}.pmtiles`;
}

/** Rewrites every vector source's URL to the given region's real tile URL. */
export function rewriteSourceUrls(style: MapStyleDocument, region: string): MapStyleDocument {
  const url = tileUrlForRegion(region);
  const sources = Object.fromEntries(
    Object.entries(style.sources).map(([id, source]) =>
      source.type === 'vector' ? [id, { ...source, url }] : [id, source],
    ),
  );
  return { ...style, sources };
}

/**
 * Die Quellen-ID einer Region.
 *
 * Die HAUPTREGION behält die unveränderte ID `yapaja-region`. Das ist kein
 * Schönheitsfehler, sondern Absicht: `apps/web/src/map/placeName.ts` fragt
 * Merkmale genau unter diesem Namen ab, um den Ortsnamen unter dem Fahrzeug
 * zu bestimmen. Würde hier alles umbenannt, fände es nichts mehr — und zwar
 * lautlos, denn eine Abfrage auf eine unbekannte Quelle liefert einfach eine
 * leere Liste.
 */
export function regionSourceId(region: string, istHaupt: boolean): string {
  return istHaupt ? REGION_SOURCE_ID : `${REGION_SOURCE_ID}-${region}`;
}

/**
 * Schreibt den Stil auf MEHRERE Regionen um — eine Quelle je Region, und
 * jede Ebene einmal je Quelle.
 *
 * ─── DIE REIHENFOLGE IST DAS GANZE ──────────────────────────────────────────
 * Vervielfacht wird JE EBENE, nicht je Region. Also erst alle Hintergründe,
 * dann alle Landflächen, dann alle Straßen, dann alle Beschriftungen.
 *
 * Andersherum — erst ganz Deutschland, dann ganz die Schweiz — läge der
 * Hintergrund der Schweiz ÜBER Deutschlands Beschriftung, und die deutschen
 * Ortsnamen verschwänden hinter einer grauen Fläche. MapLibre zeichnet
 * strikt von oben nach unten; die Reihenfolge ist hier kein Stil, sondern
 * Bedeutung (siehe Kopf von `baseLayers.ts`).
 *
 * Der Hintergrund kommt GENAU EINMAL: er hängt an keiner Quelle, und
 * mehrfach gezeichnet verdeckte er alles unter sich.
 */
export function rewriteToRegions(style: MapStyleDocument, regionen: readonly string[]): MapStyleDocument {
  if (regionen.length === 0) return style;
  if (regionen.length === 1) return rewriteSourceUrls(style, regionen[0]);

  const sources: Record<string, StyleSource> = {};
  for (const [i, region] of regionen.entries()) {
    sources[regionSourceId(region, i === 0)] = {
      type: 'vector',
      url: tileUrlForRegion(region),
    };
  }
  // Nicht-Vektorquellen (falls je welche dazukommen) unverändert übernehmen.
  for (const [id, source] of Object.entries(style.sources)) {
    if (source.type !== 'vector') sources[id] = source;
  }

  const layers = style.layers.flatMap((layer) => {
    if (!('source' in layer) || layer.source === undefined) {
      return [layer];
    }
    return regionen.map((region, i) => {
      const quelle = regionSourceId(region, i === 0);
      return {
        ...layer,
        // Die ID der Hauptregion bleibt unverändert -- Tests, Doku und alles,
        // was Ebenen beim Namen nennt, sprechen weiter dieselbe Sprache.
        id: i === 0 ? layer.id : `${layer.id}__${region}`,
        source: quelle,
      };
    });
  });

  return { ...style, sources, layers };
}
