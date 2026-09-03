/**
 * Persisted style selection + options (E01-T4).
 *
 * Persists to localStorage:
 *  - `yapaja.styleId`      the selected style id (as named in the task spec)
 *  - `yapaja.styleOptions` the {lang, labelScale, poi} option set (JSON)
 */

import { create } from 'zustand';
import {
  DEFAULT_STYLE_ID,
  DEFAULT_STYLE_OPTIONS,
  type StyleLabelScale,
  type StyleLang,
  type StyleOptions,
  type StylePoiDensity,
} from '../map/styleClient';

const STYLE_ID_KEY = 'yapaja.styleId';
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
const VALID_LABEL_SCALE: readonly StyleLabelScale[] = ['1.0', '1.2'];
const VALID_POI: readonly StylePoiDensity[] = ['full', 'reduced', 'off'];

function readInitialStyleId(): string {
  if (typeof window === 'undefined') {
    return DEFAULT_STYLE_ID;
  }
  try {
    return window.localStorage.getItem(STYLE_ID_KEY) || DEFAULT_STYLE_ID;
  } catch {
    return DEFAULT_STYLE_ID;
  }
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
    labelScale: (VALID_LABEL_SCALE as readonly string[]).includes(parsed.labelScale ?? '')
      ? (parsed.labelScale as StyleLabelScale)
      : DEFAULT_STYLE_OPTIONS.labelScale,
    poi: (VALID_POI as readonly string[]).includes(parsed.poi ?? '')
      ? (parsed.poi as StylePoiDensity)
      : DEFAULT_STYLE_OPTIONS.poi,
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

interface StyleStoreState {
  styleId: string;
  options: StyleOptions;
  setStyleId: (id: string) => void;
  setLang: (lang: StyleLang) => void;
  setLabelScale: (labelScale: StyleLabelScale) => void;
  setPoi: (poi: StylePoiDensity) => void;
}

export const useStyleStore = create<StyleStoreState>((set, get) => ({
  styleId: readInitialStyleId(),
  options: readInitialOptions(),

  setStyleId: (id) => {
    set({ styleId: id });
    persist(STYLE_ID_KEY, id);
  },

  setLang: (lang) => {
    const options = { ...get().options, lang };
    set({ options });
    persist(STYLE_OPTIONS_KEY, JSON.stringify(options));
  },

  setLabelScale: (labelScale) => {
    const options = { ...get().options, labelScale };
    set({ options });
    persist(STYLE_OPTIONS_KEY, JSON.stringify(options));
  },

  setPoi: (poi) => {
    const options = { ...get().options, poi };
    set({ options });
    persist(STYLE_OPTIONS_KEY, JSON.stringify(options));
  },
}));
