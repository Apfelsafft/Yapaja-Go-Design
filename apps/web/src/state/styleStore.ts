/**
 * Persisted style selection + options (E01-T4).
 *
 * Persists to localStorage:
 *  - `yapaja.stilHell` / `yapaja.stilDunkel`  der Stil je Thema (seit 0.21)
 *  - `yapaja.styleOptions` the {lang, labelScale, poi} option set (JSON)
 */

import { create } from 'zustand';
import { labelGroesse, parseAbgeschaltet, POI_SCHLUESSEL } from '@yapaia/shared';
import {
  DEFAULT_STYLE_ID,
  DEFAULT_STYLE_OPTIONS,
  type StyleLabelScale,
  type StyleLang,
  type StyleOptions,
  type StylePoiDensity,
} from '../map/styleClient';

const STYLE_OPTIONS_KEY = 'yapaja.styleOptions';

const VALID_LANG: readonly StyleLang[] = ['name', 'name_de', 'name_en'];

/**
 * Wer vor 0.3.7 „Deutsch" oder „English" gewaehlt hat, hat `name:de` bzw.
 * `name:en` im Browser gespeichert — Felder, die es in den Kacheln nicht gibt
 * (siehe `apps/core/src/map/styles/options.ts`). Die Wahl bleibt erhalten und
 * zeigt jetzt auf das Feld, das wirklich existiert; ohne diese Umschreibung
 * faende die Pruefung unten einen unbekannten Wert und saesse still auf
 * „Original" zurueck — die Einstellung waere ohne Vorwarnung weg.
 */
const LANG_ALIASES: Readonly<Record<string, StyleLang>> = {
  'name:de': 'name_de',
  'name:en': 'name_en',
};
const VALID_POI: readonly StylePoiDensity[] = ['full', 'reduced', 'off'];

// ─── EIN STIL FÜR HELL, EINER FÜR DUNKEL ─────────────────────────────────────
// Gemeldet: „Es wird zwar automatisch zwischen hell und dunkel umgestellt.
// Wenn ich aber einen anderen Kartenstil wähle, wird das überschrieben
// (dunkles Theme mit heller Karte)." Gewünscht: je Thema einen eigenen Stil,
// frei aus allen verfügbaren.
//
// Bis 0.20 gab es EINEN gewählten Stil, und die Themensteuerung schrieb ihn
// beim Wechsel auf Hell/Dunkel um -- außer, er war „Kontrast", dann ließ sie
// ihn stehen. Wer „Natur" wählte, bekam beim nächsten Sonnenuntergang
// „Dunkel", oder eben gar keinen Wechsel. Jetzt gibt es zwei Plätze, und das
// Thema wählt nur noch, WELCHER gilt. Die Wahl selbst fasst es nie an.
export const STIL_HELL_KEY = 'yapaja.stilHell';
export const STIL_DUNKEL_KEY = 'yapaja.stilDunkel';
export const STANDARD_STIL_HELL = DEFAULT_STYLE_ID;
export const STANDARD_STIL_DUNKEL = 'yapaja-dark';

export type StilThema = 'light' | 'dark';

function leseStil(key: string, standard: string): string {
  if (typeof window === 'undefined') return standard;
  try {
    return window.localStorage.getItem(key) || standard;
  } catch {
    return standard;
  }
}

function aktiverStil(thema: StilThema, hell: string, dunkel: string): string {
  return thema === 'dark' ? dunkel : hell;
}

/**
 * Macht aus dem, was im Browser steht, eine gueltige Optionsmenge.
 *
 * Eigene, exportierte Funktion, damit sie geprueft werden kann: die
 * Umschreibung alter Sprachwerte greift nur beim ERSTEN Laden mit einem
 * bereits gefuellten localStorage — genau der Fall, den ein Test sonst nicht
 * erreicht, weil diese Datei ihren Anfangszustand beim Import festlegt.
 */
export function normalizeStoredOptions(parsed: Partial<StyleOptions>): StyleOptions {
  const storedLang = parsed.lang ?? '';
  const lang = LANG_ALIASES[storedLang] ?? storedLang;
  return {
    lang: (VALID_LANG as readonly string[]).includes(lang)
      ? (lang as StyleLang)
      : DEFAULT_STYLE_OPTIONS.lang,
    // Seit 0.21 ein Schieberegler von 80 % bis 200 %; die alten Stufen
    // `1.0` und `1.2` sind darin enthalten und bleiben, was sie waren.
    labelScale: labelGroesse(parsed.labelScale) ?? DEFAULT_STYLE_OPTIONS.labelScale,
    poi: (VALID_POI as readonly string[]).includes(parsed.poi ?? '')
      ? (parsed.poi as StylePoiDensity)
      : DEFAULT_STYLE_OPTIONS.poi,
    // ─── UNBEKANNTE SCHLUESSEL FALLEN WEG ──────────────────────────────────
    // `parseAbgeschaltet` kennt nur, was im Katalog steht. Eine Kategorie,
    // die es nicht mehr gibt, verschwindet damit aus der Einstellung, statt
    // ewig darin zu liegen -- und zwar in die Richtung, in der nichts
    // verborgen bleibt: die Kategorie ist dann eben da.
    //
    // Der `Array.isArray`-Test davor faengt den anderen Fall: im
    // localStorage kann alles stehen, auch eine Zahl oder `null`, und
    // `.filter` daran waere ein Absturz beim Start.
    poiAus: parseAbgeschaltet(
      Array.isArray(parsed.poiAus) ? parsed.poiAus.filter((w) => typeof w === 'string').join(',') : '',
    ),
  };
}

function readInitialOptions(): StyleOptions {
  if (typeof window === 'undefined') {
    return DEFAULT_STYLE_OPTIONS;
  }
  try {
    const raw = window.localStorage.getItem(STYLE_OPTIONS_KEY);
    if (!raw) {
      return DEFAULT_STYLE_OPTIONS;
    }
    return normalizeStoredOptions(JSON.parse(raw) as Partial<StyleOptions>);
  } catch {
    return DEFAULT_STYLE_OPTIONS;
  }
}

function persist(key: string, value: string): void {
  if (typeof window === 'undefined') {
    return;
  }
  try {
    window.localStorage.setItem(key, value);
  } catch (err) {
    // Private-mode / quota errors must never break style switching.
    console.warn('[styleStore] Failed to persist to localStorage:', err);
  }
}

// ─── POI-CHIPS IN DER KOPFZEILE ─────────────────────────────────────────────
// Gewünscht: „Können wir da noch einen Marker einbauen, damit die als Chips
// wie bei Maps in der Kopfzeile sichtbar sind? Wenn man auf einen Chip klickt,
// wird dieser aktiviert und nur die POIs der aktivierten Chips werden
// angezeigt."
//
// Zwei Dinge, zwei Zustände:
//   `poiChips`    WELCHE Kategorien als Chip oben stehen -- eine Einstellung,
//                 gespeichert, gesetzt mit dem 📌 in den Einstellungen.
//   `chipFilter`  welche Chips gerade AN sind -- ein Blick, nicht gespeichert.
//                 Nach dem Neuladen ist die Karte wieder so, wie die
//                 Einstellungen sagen, und nicht auf „nur Tankstellen"
//                 festgeklemmt, ohne dass man noch weiß, warum.
//
// Ist mindestens ein Chip an, zeigt die Karte NUR dessen Kategorien; die
// Schalter in den Einstellungen bleiben dabei unberührt.
export const POI_CHIPS_KEY = 'yapaja.poiChips';
export const STANDARD_POI_CHIPS: readonly string[] = [
  'poi-wohnmobil',
  'poi-camping',
  'poi-tanken',
  'poi-entsorgung',
  'poi-frischwasser',
  'poi-einkaufen',
];

function leseChips(): string[] {
  if (typeof window === 'undefined') return [...STANDARD_POI_CHIPS];
  try {
    const roh = window.localStorage.getItem(POI_CHIPS_KEY);
    if (roh === null) return [...STANDARD_POI_CHIPS];
    const liste = JSON.parse(roh) as unknown;
    return Array.isArray(liste) ? parseAbgeschaltet(liste.filter((w) => typeof w === 'string').join(',')) : [...STANDARD_POI_CHIPS];
  } catch {
    return [...STANDARD_POI_CHIPS];
  }
}

/**
 * Welche Kategorien die Karte WIRKLICH weglässt: mit aktivem Chip-Filter
 * alles außer den Chips, sonst die Auswahl aus den Einstellungen.
 */
export function wirksamesPoiAus(poiAus: readonly string[], chipFilter: readonly string[]): string[] {
  if (chipFilter.length === 0) return [...poiAus];
  return POI_SCHLUESSEL.filter((k) => !chipFilter.includes(k));
}

interface StyleStoreState {
  /** Der Stil, der GERADE gilt -- abgeleitet aus Thema und den beiden Plätzen. */
  styleId: string;
  stilHell: string;
  stilDunkel: string;
  /** Welches Thema gerade gilt; setzt nur die Themensteuerung. */
  thema: StilThema;
  options: StyleOptions;
  /** Setzt den Stil für das GERADE geltende Thema -- sichtbar sofort. */
  setStyleId: (id: string) => void;
  /** Setzt den Stil für ein bestimmtes Thema. */
  setStilFuer: (thema: StilThema, id: string) => void;
  /** Schaltet um, welcher der beiden Plätze gilt. */
  setThema: (thema: StilThema) => void;
  setLang: (lang: StyleLang) => void;
  setLabelScale: (labelScale: StyleLabelScale) => void;
  setPoi: (poi: StylePoiDensity) => void;
  /** Eine einzelne Kategorie an- (`an: true`) oder abschalten. */
  setPoiKategorie: (schluessel: string, an: boolean) => void;
  /** Alle auf einmal — `[]` heisst „alle an". */
  setPoiAus: (poiAus: readonly string[]) => void;
  /** Kategorien, die als Chip in der Kopfzeile stehen. */
  poiChips: string[];
  setPoiChip: (schluessel: string, alsChip: boolean) => void;
  /** Gerade aktive Chips -- leer heisst „kein Filter". */
  chipFilter: string[];
  toggleChip: (schluessel: string) => void;
}

const anfangHell = leseStil(STIL_HELL_KEY, STANDARD_STIL_HELL);
const anfangDunkel = leseStil(STIL_DUNKEL_KEY, STANDARD_STIL_DUNKEL);

export const useStyleStore = create<StyleStoreState>((set, get) => ({
  styleId: anfangHell,
  stilHell: anfangHell,
  stilDunkel: anfangDunkel,
  thema: 'light',
  options: readInitialOptions(),

  setStyleId: (id) => get().setStilFuer(get().thema, id),

  setStilFuer: (thema, id) => {
    const stilHell = thema === 'light' ? id : get().stilHell;
    const stilDunkel = thema === 'dark' ? id : get().stilDunkel;
    set({ stilHell, stilDunkel, styleId: aktiverStil(get().thema, stilHell, stilDunkel) });
    persist(thema === 'light' ? STIL_HELL_KEY : STIL_DUNKEL_KEY, id);
  },

  setThema: (thema) => {
    const { stilHell, stilDunkel } = get();
    const styleId = aktiverStil(thema, stilHell, stilDunkel);
    if (thema === get().thema && styleId === get().styleId) return;
    set({ thema, styleId });
  },

  setLang: (lang) => {
    const options = { ...get().options, lang };
    set({ options });
    persist(STYLE_OPTIONS_KEY, JSON.stringify(options));
  },

  setLabelScale: (roh) => {
    const labelScale = labelGroesse(roh) ?? DEFAULT_STYLE_OPTIONS.labelScale;
    if (labelScale === get().options.labelScale) return;
    const options = { ...get().options, labelScale };
    set({ options });
    persist(STYLE_OPTIONS_KEY, JSON.stringify(options));
  },

  setPoi: (poi) => {
    const options = { ...get().options, poi };
    set({ options });
    persist(STYLE_OPTIONS_KEY, JSON.stringify(options));
  },

  setPoiKategorie: (schluessel, an) => {
    const bisher = get().options.poiAus;
    const naechste = an ? bisher.filter((s) => s !== schluessel) : [...bisher, schluessel];
    // Ueber `parseAbgeschaltet`, nicht roh: das wirft Doppelte weg und bringt
    // die Liste in die Katalogreihenfolge. Ohne das waere `poiAus` von der
    // Klickreihenfolge abhaengig -- derselbe Zustand ergaebe zwei
    // verschiedene Stil-Adressen und damit zwei Abrufe statt einem.
    const options = { ...get().options, poiAus: parseAbgeschaltet(naechste.join(',')) };
    set({ options });
    persist(STYLE_OPTIONS_KEY, JSON.stringify(options));
  },

  setPoiAus: (poiAus) => {
    const options = { ...get().options, poiAus: parseAbgeschaltet(poiAus.join(',')) };
    set({ options });
    persist(STYLE_OPTIONS_KEY, JSON.stringify(options));
  },

  poiChips: leseChips(),
  setPoiChip: (schluessel, alsChip) => {
    const bisher = get().poiChips;
    const poiChips = parseAbgeschaltet((alsChip ? [...bisher, schluessel] : bisher.filter((k) => k !== schluessel)).join(','));
    // Ein Chip, der nicht mehr oben steht, darf nicht unsichtbar weiterfiltern.
    const chipFilter = get().chipFilter.filter((k) => poiChips.includes(k));
    set({ poiChips, chipFilter });
    persist(POI_CHIPS_KEY, JSON.stringify(poiChips));
  },

  chipFilter: [],
  toggleChip: (schluessel) => {
    const bisher = get().chipFilter;
    const chipFilter = bisher.includes(schluessel) ? bisher.filter((k) => k !== schluessel) : [...bisher, schluessel];
    set({ chipFilter: parseAbgeschaltet(chipFilter.join(',')) });
  },
}));

declare global {
  interface Window {
    /** Debug/E2E-Zugang, wie `__yapaiaThemeStore`. */
    __yapaiaStyleStore?: typeof useStyleStore;
  }
}

if (typeof window !== 'undefined') {
  window.__yapaiaStyleStore = useStyleStore;
}
