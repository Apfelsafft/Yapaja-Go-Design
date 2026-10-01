/**
 * Fetches the core-served style system (E01-T4): the available style list
 * and individual style JSONs, with the `lang` / `labelScale` / `poi`
 * options applied server-side (docs/03-api-spec.md §2).
 *
 * Like `apps/web/src/map/regions.ts`, every URL is built from
 * `import.meta.env.BASE_URL` (never a hardcoded `/api/...` path), so this
 * keeps working when served under an ingress sub-path (W-15).
 */

import type { StyleSpecification } from 'maplibre-gl';
import { alsPoiParameter, labelGroesse } from '@yapaia/shared';

/** Siehe `apps/core/src/map/styles/options.ts`: unsere Kacheln fuehren
 *  `name`, `name_de` und `name_en` — `name:de` gibt es dort NICHT, und die
 *  Wahl „Deutsch" liess deshalb bis 0.3.6 jede Beschriftung verschwinden. */
export type StyleLang = 'name' | 'name_de' | 'name_en';
/** `0.8` bis `2.0` in Zehnteln, als Zeichenkette (`labelGroesse` in `@yapaia/shared`). */
export type StyleLabelScale = string;
export type StylePoiDensity = 'full' | 'reduced' | 'off';

export interface StyleOptions {
  lang: StyleLang;
  labelScale: StyleLabelScale;
  poi: StylePoiDensity;
  /**
   * Sonderziel-Kategorien, die NICHT gezeichnet werden — als Sprite-Namen
   * aus `POI_AUSWAHL` (`@yapaia/shared`).
   *
   * ─── GESPEICHERT WIRD DAS ABGESCHALTETE ────────────────────────────────
   * Nicht das eingeschaltete. Kommt in einer spaeteren Fassung eine
   * Kategorie dazu, ist sie damit DA und nicht weg. Fuer eine Karte, die
   * sagen soll, wo es Wasser gibt, ist das die einzig vertretbare Richtung:
   * ein ungewolltes Symbol klickt man weg, ein fehlendes bemerkt man erst,
   * wenn man daran vorbeigefahren ist.
   */
  poiAus: string[];
}

export interface StyleSummary {
  id: string;
  name: string;
  preview?: string;
}

export const DEFAULT_STYLE_ID = 'yapaja-light';

export const DEFAULT_STYLE_OPTIONS: StyleOptions = {
  lang: 'name',
  labelScale: '1.0',
  poi: 'full',
  // Alles an. Wer nichts einstellt, sieht alles -- das ist der Zustand, in
  // dem die Karte am meisten sagt.
  poiAus: [],
};

/**
 * Quality caps the performance watchdog (E01-T6) may impose transiently under
 * low FPS. These are NEVER persisted and NEVER overwrite the user's chosen
 * `StyleOptions` — the effective render options are the user's choice *clamped
 * down* by any active cap (see `applyDegradationCaps`). `null` means "no cap".
 */
export interface StyleQualityCaps {
  poi: StylePoiDensity | null;
  labelScale: StyleLabelScale | null;
}

export const NO_STYLE_QUALITY_CAPS: StyleQualityCaps = { poi: null, labelScale: null };

// Quality rank (higher = more detail / more expensive to render). A cap can
// only pull the effective value DOWN to its own rank, never up — so a user who
// chose `poi: 'off'` is never forced back to 'full' by a degradation cap.
const POI_RANK: Record<StylePoiDensity, number> = { off: 0, reduced: 1, full: 2 };

/**
 * Combines the user's persisted `StyleOptions` with any active degradation
 * caps, returning the *effective* options to actually fetch/render with. Each
 * capped field is clamped to the lower of (user choice, cap); `lang` is never
 * a performance concern and always passes through unchanged.
 */
export function applyDegradationCaps(
  options: StyleOptions,
  caps: StyleQualityCaps,
): StyleOptions {
  const poi =
    caps.poi !== null && POI_RANK[caps.poi] < POI_RANK[options.poi] ? caps.poi : options.poi;
  const labelScale =
    caps.labelScale !== null &&
    Number(labelGroesse(caps.labelScale) ?? '1.0') < Number(labelGroesse(options.labelScale) ?? '1.0')
      ? caps.labelScale
      : options.labelScale;
  // `poiAus` geht unveraendert durch: die Kategorie-Wahl ist eine Aussage des
  // Fahrers, keine Frage an die Leistung des Geraets. Die Ueberwachung darf
  // Symbole WEGNEHMEN (ueber `poi`), aber keine zurueckholen, die jemand
  // bewusst abgeschaltet hat.
  return { lang: options.lang, labelScale, poi, poiAus: options.poiAus };
}

interface StylesListApiResponse {
  data: StyleSummary[];
}

function stylesBaseUrl(): string {
  return `${import.meta.env.BASE_URL}api/v1/map/styles`;
}

/** Fetches the list of available styles. Returns [] (never throws) on
 *  network/parse failure, mirroring `fetchRegions`. */
export async function fetchStyleSummaries(): Promise<StyleSummary[]> {
  try {
    const response = await fetch(stylesBaseUrl());
    if (!response.ok) {
      return [];
    }
    const body = (await response.json()) as StylesListApiResponse;
    return Array.isArray(body?.data) ? body.data : [];
  } catch {
    return [];
  }
}

/**
 * Fetches a single style's JSON with the given options applied. Falls back
 * to `DEFAULT_STYLE_ID` if the requested id 404s (e.g. a stale persisted
 * choice from a core that no longer ships that style), and to `null` if
 * even that fails — callers must handle `null` with `buildFallbackStyle()`
 * (never crash / never show a broken map, per E01-T2's "no-region"
 * philosophy).
 */
export async function fetchStyle(
  styleId: string,
  options: StyleOptions,
  /**
   * Fuer welche Kartenregion die Kachel-URL im Stil gebaut werden soll.
   *
   * Ohne diesen Parameter nimmt der Core seine eigene Vorgabe — die ERSTE
   * installierte Region (`apps/core/src/map/routes.ts`), und `listRegions`
   * sortiert alphabetisch. Genau daran lag die leere Karte: mit
   * Liechtenstein und Rheinland-Pfalz installiert gewann immer
   * Liechtenstein, waehrend Follow-Me die Kamera nach Rheinland-Pfalz zog.
   * Wer eine Region anzeigen will, muss sie also benennen; siehe
   * `activeRegion.ts` fuer die Auswahl.
   */
  region?: string,
): Promise<StyleSpecification | null> {
  const params = new URLSearchParams({
    lang: options.lang,
    labelScale: options.labelScale,
    poi: options.poi,
  });
  // Nur mitschicken, wenn wirklich etwas aus ist. Ein leeres `poiAus=` waere
  // eine zweite Schreibweise fuer denselben Zustand -- und damit ein zweiter
  // Eintrag im Zwischenspeicher des Browsers fuer dieselbe Karte.
  //
  // ─── DAS `?? []` IST NICHT UEBERFLUESSIG ────────────────────────────────
  // Die Typangabe sagt, dass `poiAus` da ist, und aus dem Speicher kommt es
  // auch immer (`normalizeStoredOptions` fuellt es). Aber ein Absturz GENAU
  // HIER heisst: gar keine Karte. Diese Datei faengt aus demselben Grund
  // schon jeden Netzfehler ab und liefert lieber `null` als eine Ausnahme.
  // Ein fehlendes Feld -- etwa aus einem aelteren gespeicherten Zustand oder
  // einem Aufrufer, der die Menge von Hand baut -- darf nicht mehr kosten
  // als ein fehlgeschlagener Abruf.
  const aus = alsPoiParameter(options.poiAus ?? []);
  if (aus) {
    params.set('poiAus', aus);
  }
  if (region) {
    params.set('region', region);
  }

  try {
    const response = await fetch(`${stylesBaseUrl()}/${encodeURIComponent(styleId)}?${params.toString()}`);
    if (!response.ok) {
      if (styleId !== DEFAULT_STYLE_ID) {
        return fetchStyle(DEFAULT_STYLE_ID, options, region);
      }
      return null;
    }
    return spriteAbsolut((await response.json()) as StyleSpecification, stilBasis());
  } catch {
    return null;
  }
}

/** Woran relative Adressen im Stil gemessen werden: die Wurzel der Anwendung. */
function stilBasis(): string {
  const seite = typeof window !== 'undefined' ? window.location.href : 'http://localhost/';
  return new URL(import.meta.env.BASE_URL ?? '/', seite).href;
}

/**
 * Macht die `sprite`-Adresse absolut.
 *
 * ─── DER GEMELDETE FALL ─────────────────────────────────────────────────────
 * „Können wir vielleicht kleine Icons für die POIs einblenden? Ich erkenne
 * nicht auf Anhieb, wo bspw. ein Womo-Stellplatz ist."
 *
 * Die Icons gab es längst -- ein Symbol je Kategorie, dazu die gelben und
 * blauen Straßenschilder. Gezeichnet wurde keines davon. MapLibre 6 verlangt
 * für `sprite` eine ABSOLUTE Adresse und meldet sonst nur in die Konsole:
 *
 *   Invalid sprite URL "./sprites/yapaja", must be absolute.
 *
 * Für `glyphs` gilt das nicht, darum erschien die Schrift und alles sah fast
 * richtig aus. Der Kern liefert die Adresse bewusst relativ (er kennt den
 * Ingress-Pfad von Home Assistant nicht); aufgelöst wird deshalb HIER, wo
 * die Seite weiß, unter welcher Adresse sie läuft.
 */
export function spriteAbsolut(style: StyleSpecification, basis: string): StyleSpecification {
  const absolut = (url: string): string => {
    try {
      return new URL(url, basis).href;
    } catch {
      return url;
    }
  };
  const sprite = style.sprite;
  if (typeof sprite === 'string') {
    return { ...style, sprite: absolut(sprite) };
  }
  if (Array.isArray(sprite)) {
    return { ...style, sprite: sprite.map((s) => ({ ...s, url: absolut(s.url) })) };
  }
  return style;
}

/**
 * Last-resort style used only if the core is unreachable or has no styles
 * registered at all. A plain background keeps the map canvas rendering
 * (never a crash / blank white screen) even in that unlikely case — mirrors
 * the defensive philosophy of MapView's "no-region" empty state.
 */
export function buildFallbackStyle(): StyleSpecification {
  return {
    version: 8,
    sources: {},
    layers: [{ id: 'background', type: 'background', paint: { 'background-color': '#EAE7DC' } }],
  };
}
