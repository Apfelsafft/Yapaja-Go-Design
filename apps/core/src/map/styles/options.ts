/**
 * Style-option transforms (`?lang=`, `?labelScale=`, `?poi=`): pure
 * functions over a style document's `layers` array, composed by
 * `applyStyleOptions`. Each transform is independent and only touches the
 * layers it's responsible for (classified by the naming convention
 * documented in `constants.ts` / `yapaja-light.ts`), so adding a new
 * transform later is just "write a pure `(layers) => layers` function and
 * wire it into `applyStyleOptions`" — no other module needs to change.
 *
 * Query params are treated as *optional overrides*: a param that's absent
 * (not merely invalid) leaves that aspect of the style untouched, so a
 * style's own baked-in defaults (e.g. `yapaja-contrast`'s reduced POI) stay
 * intact unless a caller explicitly overrides them.
 */

import { nichtAbgeschaltet, parseAbgeschaltet, symbolNachKategorie } from '@yapaia/shared';
import { POI_LAYER_ID_PREFIX, REDUCED_POI_CLASSES } from './constants.js';
import type { MapStyleDocument, StyleLayer, SymbolLayer } from './types.js';

/**
 * Das Feld, aus dem die Beschriftung kommt.
 *
 * ─── WARUM `name_de` UND NICHT `name:de` ────────────────────────────────────
 * Bis 0.3.6 standen hier `name:de` und `name:en`. Diese Felder gibt es in
 * unseren Kacheln NICHT. Das OpenMapTiles-Profil schreibt an jedes
 * beschriftbare Element genau diesen Satz (`OmtLanguageUtils.getNames`):
 *
 *   name, name_en, name_de, name:latin, name:nonlatin, name_int
 *
 * `name:de` entsteht nur, wenn planetiler mit `--languages=…` laeuft — unser
 * Kachelbau tut das nicht (siehe `services/tiles/build-pmtiles.sh`,
 * DEFAULT_ARGS). Wer also „Deutsch" waehlte, bekam `['get', 'name:de']` auf
 * JEDER Symbol-Ebene, und damit eine Karte OHNE jede Beschriftung: kein Ort,
 * keine Strasse, kein Gewaesser. MapLibre meldet das nicht — ein fehlendes
 * Feld ist kein Fehler, sondern ein leerer Text.
 *
 * `name_de` ist ausserdem das bessere Feld: es faellt im Profil selbst auf
 * `name` zurueck, wenn kein deutscher Name getaggt ist. Eine Strasse ohne
 * `name:de`-Tag verschwindet also nicht, sondern behaelt ihren Namen.
 */
export type StyleLang = 'name' | 'name_de' | 'name_en';
export type StyleLabelScale = '1.0' | '1.2';
export type StylePoiDensity = 'full' | 'reduced' | 'off';

/**
 * Was frueher ausgeliefert wurde, bleibt gueltig — gespeicherte Einstellungen
 * im Browser und Lesezeichen auf eine Stil-URL sollen nicht ins Leere laufen.
 * Sie zeigen jetzt auf das Feld, das es wirklich gibt.
 */
const LANG_ALIASES: Readonly<Record<string, StyleLang>> = {
  'name:de': 'name_de',
  'name:en': 'name_en',
};

export interface StyleOptions {
  lang?: StyleLang;
  labelScale?: StyleLabelScale;
  poi?: StylePoiDensity;
  /**
   * Sonderziel-Kategorien, die NICHT gezeichnet werden sollen — als
   * Sprite-Namen, siehe `@yapaia/shared`'s `poi/auswahl.ts`.
   *
   * ─── WARUM NEBEN `poi` UND NICHT STATT DESSEN ─────────────────────────────
   * Die beiden beantworten verschiedene Fragen. `poi` ist eine Frage an das
   * GERÄT („wie viel Zeichenarbeit verträgt es"), und nur deshalb darf die
   * Leistungsüberwachung sie herunterdrehen (`applyDegradationCaps` in
   * `apps/web`). Diese Liste ist eine Frage an den FAHRER („was interessiert
   * mich"), und die darf niemand anders beantworten.
   *
   * Sie sind deshalb zwei Achsen und wirken nacheinander: erst was die
   * Dichte übrig lässt, davon dann alles, was nicht abgeschaltet ist.
   */
  poiAus?: readonly string[];
}

const VALID_LANG: readonly StyleLang[] = ['name', 'name_de', 'name_en'];
const VALID_LABEL_SCALE: readonly StyleLabelScale[] = ['1.0', '1.2'];
const VALID_POI: readonly StylePoiDensity[] = ['full', 'reduced', 'off'];

/** Raw, not-yet-validated query values (Fastify querystring shape). */
export interface RawStyleQuery {
  lang?: unknown;
  labelScale?: unknown;
  poi?: unknown;
  poiAus?: unknown;
}

function firstValue(value: unknown): string | undefined {
  if (Array.isArray(value)) {
    return typeof value[0] === 'string' ? value[0] : undefined;
  }
  return typeof value === 'string' ? value : undefined;
}

/**
 * Parses+validates style-option query params. Unknown/invalid values are
 * silently dropped (defensive: a malformed `?poi=whatever` must never crash
 * the endpoint — it just falls back to leaving that option untouched, same
 * as if it had been omitted).
 */
export function parseStyleOptions(query: RawStyleQuery): StyleOptions {
  const options: StyleOptions = {};

  const lang = firstValue(query.lang);
  if (lang) {
    const resolved = LANG_ALIASES[lang] ?? lang;
    if ((VALID_LANG as readonly string[]).includes(resolved)) {
      options.lang = resolved as StyleLang;
    }
  }

  const labelScale = firstValue(query.labelScale);
  if (labelScale && (VALID_LABEL_SCALE as readonly string[]).includes(labelScale)) {
    options.labelScale = labelScale as StyleLabelScale;
  }

  const poi = firstValue(query.poi);
  if (poi && (VALID_POI as readonly string[]).includes(poi)) {
    options.poi = poi as StylePoiDensity;
  }

  // ─── NUR SETZEN, WENN WIRKLICH ETWAS ABGESCHALTET IST ────────────────────
  // `parseAbgeschaltet` wirft unbekannte Schlüssel weg. `?poiAus=` oder
  // `?poiAus=quatsch` ergibt damit eine leere Liste — und die ist dasselbe
  // wie „nicht mitgeschickt". Sie trotzdem zu setzen hiesse, den Stil ohne
  // Not umzuschreiben und den Zwischenspeicher zu verfehlen.
  const poiAus = parseAbgeschaltet(firstValue(query.poiAus));
  if (poiAus.length > 0) {
    options.poiAus = poiAus;
  }

  return options;
}

function isSymbolLayer(layer: StyleLayer): layer is SymbolLayer {
  return layer.type === 'symbol';
}

function isPoiLayer(layer: StyleLayer): layer is SymbolLayer {
  return isSymbolLayer(layer) && layer.id.startsWith(POI_LAYER_ID_PREFIX);
}

/**
 * Ob eine Ebene einen NAMEN beschriftet — und die Sprachwahl sie deshalb
 * angeht.
 *
 * ─── WOFUER ─────────────────────────────────────────────────────────────────
 * `applyLang` hat bis 0.8.14 `text-field` auf JEDER Symbol-Ebene ersetzt. Das
 * war richtig, solange jede Symbol-Ebene einen Namen zeigte. Mit den
 * Strassennummern (`road-shields`, `['get', 'ref']`) stimmt das nicht mehr:
 * die Nummer einer Autobahn hat keine Sprache, und ein `?lang=name_de` haette
 * sie durch den Namen ersetzt, den eine Autobahn meist gar nicht hat. Die
 * Ebene waere still leer geblieben — genau die Sorte Fehler, die im Kopf von
 * `labelFields.test.ts` steht.
 *
 * ─── WARUM NICHT EINFACH DIE ID AUSNEHMEN ───────────────────────────────────
 * Weil dann jede kuenftige Ebene, die etwas anderes als einen Namen zeigt
 * (Hausnummern, Hoehenangaben, Streckennummern), denselben Fehler neu macht
 * und niemand daran denkt. Die Frage „ist das ein Name?" laesst sich am Feld
 * selbst beantworten, und damit gilt die Regel fuer alles, was noch kommt.
 */
function beschriftetEinenNamen(layer: SymbolLayer): boolean {
  const feld = layer.layout['text-field'];
  if (!Array.isArray(feld) || feld.length !== 2 || feld[0] !== 'get') {
    // Etwas anderes als ein schlichtes `['get', X]` — zusammengesetzte
    // Ausdruecke fasst die Sprachwahl nicht an, statt sie plattzumachen.
    return false;
  }
  return typeof feld[1] === 'string' && feld[1].startsWith('name');
}

function applyLang(layer: StyleLayer, lang: StyleLang): StyleLayer {
  if (!isSymbolLayer(layer) || !beschriftetEinenNamen(layer)) {
    return layer;
  }
  return { ...layer, layout: { ...layer.layout, 'text-field': ['get', lang] } };
}

function applyLabelScale(layer: StyleLayer, scale: StyleLabelScale): StyleLayer {
  if (!isSymbolLayer(layer)) {
    return layer;
  }
  const currentSize = layer.layout['text-size'];
  if (typeof currentSize !== 'number') {
    // Expression-valued text-size: left untouched (documented limitation —
    // none of the shipped styles use expression sizes today).
    return layer;
  }
  const factor = scale === '1.2' ? 1.2 : 1.0;
  // Rounded to 2 decimals to keep the served JSON tidy and avoid float noise.
  const nextSize = Math.round(currentSize * factor * 100) / 100;
  return { ...layer, layout: { ...layer.layout, 'text-size': nextSize } };
}

/**
 * Die beiden POI-Achsen in einem Durchgang: Dichte und abgeschaltete
 * Kategorien.
 *
 * ─── WARUM BEIDE HIER UND NICHT NACHEINANDER ────────────────────────────────
 * Weil sie sich denselben `filter` teilen. Zwei getrennte Durchläufe müssten
 * jeweils lesen, was der andere hinterlassen hat, und beim zweiten Aufruf
 * wüsste keiner mehr, welcher Teil des Ausdrucks wem gehört. Zusammengesetzt
 * wird der Filter deshalb an genau einer Stelle — hier — und immer von vorn.
 *
 * ─── WORAN DIE KATEGORIE ERKANNT WIRD ───────────────────────────────────────
 * An `symbolNachKategorie()` — DERSELBEN Funktion, die weiter oben im Stil
 * auch das `icon-image` bestimmt (`baseLayers.ts`). Nicht an einer eigenen
 * Klassenliste.
 *
 * Das ist der Kern der Sache: ein Filter, der die Kategorien noch einmal
 * selbst zusammensucht, kann von den Symbolen abweichen. Dann verschwände
 * beim Abschalten von „Tankstelle" etwas anderes als die Zapfsäulen, oder es
 * bliebe etwas stehen — und beides fiele niemandem auf, weil ein POI weniger
 * auf einer Karte nun einmal nicht auffällt. Indem der Filter die
 * Symbolzuordnung AUFRUFT, ist „was als Tankstelle gezeichnet wird" und „was
 * beim Abschalten von Tankstellen verschwindet" per Bauart dasselbe.
 */
function applyPoi(
  layer: StyleLayer,
  poi: StylePoiDensity | undefined,
  poiAus: readonly string[],
): StyleLayer {
  if (!isPoiLayer(layer)) {
    return layer;
  }
  if (poi === 'off') {
    const { filter: _filter, ...rest } = layer;
    return { ...rest, layout: { ...layer.layout, visibility: 'none' } };
  }

  // ─── `poi` UNGESETZT HEISST „NICHT ANFASSEN" ──────────────────────────────
  // Und zwar auch hier, wo es verlockend wäre, `full` einzusetzen, um einen
  // Sonderfall zu sparen. Das wäre falsch, und der Kopf dieser Datei sagt
  // warum: `yapaja-contrast` bringt seine reduzierte POI-Auswahl selbst mit.
  // Wer nur eine Kategorie abschaltet und die Dichte nie angefasst hat,
  // schickt kein `?poi=` -- und bekäme mit `full` als Vorgabe plötzlich MEHR
  // Symbole als vorher. Ein Schalter, der Dinge einschaltet, ist die
  // unangenehmste Sorte Überraschung.
  //
  // Deshalb: bei ungesetztem `poi` bleibt der mitgelieferte Filter stehen,
  // und die abgeschalteten Kategorien kommen UNTEN DRAN.
  const bedingungen: unknown[][] = [];
  let sichtbarkeit = layer.layout.visibility;
  if (poi === 'reduced') {
    bedingungen.push(['in', ['get', 'class'], ['literal', REDUCED_POI_CLASSES]]);
    sichtbarkeit = 'visible';
  } else if (poi === 'full') {
    sichtbarkeit = 'visible';
  } else if (layer.filter !== undefined) {
    bedingungen.push(layer.filter);
  }

  const ohneAbgeschaltete = nichtAbgeschaltet(symbolNachKategorie(), poiAus);
  if (ohneAbgeschaltete) {
    bedingungen.push(ohneAbgeschaltete);
  }

  const { filter: _filter, ...rest } = layer;
  const layout = { ...layer.layout, ...(sichtbarkeit ? { visibility: sichtbarkeit } : {}) };
  if (bedingungen.length === 0) {
    // Kein Filter ist etwas anderes als ein Filter, der alles durchlässt:
    // MapLibre muss ihn dann gar nicht erst je Punkt auswerten.
    return { ...rest, layout };
  }
  return {
    ...rest,
    layout,
    filter: bedingungen.length === 1 ? bedingungen[0] : ['all', ...bedingungen],
  };
}

/** Applies every explicitly-provided style option to the style's layers. */
export function applyStyleOptions(style: MapStyleDocument, options: StyleOptions): MapStyleDocument {
  let layers = style.layers;

  if (options.lang) {
    const lang = options.lang;
    layers = layers.map((layer) => applyLang(layer, lang));
  }
  if (options.labelScale) {
    const labelScale = options.labelScale;
    layers = layers.map((layer) => applyLabelScale(layer, labelScale));
  }
  // ─── AUCH OHNE `poi`, WENN EINZELNE KATEGORIEN AUS SIND ──────────────────
  // Hier stand `if (options.poi)`. Das war richtig, solange es nur die Dichte
  // gab. Mit den Kategorie-Schaltern hätte es eine lautlose Lücke ergeben:
  // wer die Dichte nie angefasst hat -- also fast jeder --, schickt kein
  // `?poi=` mit, und seine abgeschalteten Kategorien wären still ohne Wirkung
  // geblieben.
  const poiAus = options.poiAus ?? [];
  if (options.poi || poiAus.length > 0) {
    const poi = options.poi;
    layers = layers.map((layer) => applyPoi(layer, poi, poiAus));
  }

  return { ...style, layers };
}
