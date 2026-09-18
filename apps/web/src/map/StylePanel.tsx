/**
 * Style / Settings Panel (E01-T4, preliminary — docs/06-ui-ux-guidelines.md
 * §6): lets the user pick a map style (`Yapaia Light` / `Dark` / `Contrast`)
 * and the label language / label scale / POI density options. All choices
 * persist via `useStyleStore` (localStorage).
 *
 * This is a stand-in for the eventual Settings surface (widget system,
 * docs/06 §2) — deliberately minimal, just enough UI to exercise and
 * demonstrate the style system end-to-end.
 */

import React, { useCallback, useEffect, useState } from 'react';
import { POI_AUSWAHL } from '@yapaia/shared';
import { useStyleStore } from '../state/styleStore';
import { fetchStyleSummaries, type StyleLabelScale, type StyleLang, type StylePoiDensity, type StyleSummary } from './styleClient';
import ThemeToggle from '../theme/ThemeToggle.js';
import FaltAbschnitt from './FaltAbschnitt.js';
import DriveLockGate from '../drive/DriveLockGate.js';
import HandednessToggle from '../shell/HandednessToggle.js';
import { useOnboardingStore } from '../onboarding/store.js';
import { bottomInsetPx } from '../shell/mapControlLayout.js';
import { useSchmal } from '../shell/useSchmal.js';
import { useNavStore } from '../drive/navStore.js';
import { isDriveActive } from '../drive/driveActive.js';

const LANG_OPTIONS: Array<{ value: StyleLang; label: string }> = [
  { value: 'name', label: 'Original' },
  { value: 'name_de', label: 'Deutsch' },
  { value: 'name_en', label: 'English' },
];

const LABEL_SCALE_OPTIONS: Array<{ value: StyleLabelScale; label: string }> = [
  { value: '1.0', label: '100%' },
  { value: '1.2', label: '120%' },
];

const POI_OPTIONS: Array<{ value: StylePoiDensity; label: string }> = [
  { value: 'full', label: 'Voll' },
  { value: 'reduced', label: 'Reduziert' },
  { value: 'off', label: 'Aus' },
];

/**
 * Die Schalter für die einzelnen Sonderziele.
 *
 * ─── DIE LISTE STEHT NICHT HIER ─────────────────────────────────────────────
 * `POI_AUSWAHL` kommt aus `@yapaia/shared` und wird dort aus den beiden
 * Kategorienlisten ABGELEITET — den Kacheln und dem Suchindex. Wer eine
 * Kategorie hinzufügt, bekommt ihren Schalter also geschenkt.
 *
 * Eine eigene Liste an dieser Stelle wäre bequemer zu lesen und genau der
 * Fehler, an dem „reduzierte POIs" monatelang keinen Supermarkt zeigte:
 * zwei Listen, eine davon still abgedriftet.
 */
function SonderzielSchalter(): React.ReactElement {
  const poiAus = useStyleStore((state) => state.options.poiAus);
  const setPoiKategorie = useStyleStore((state) => state.setPoiKategorie);
  const setPoiAus = useStyleStore((state) => state.setPoiAus);
  const alleAus = poiAus.length === POI_AUSWAHL.length;

  return (
    <div className="space-y-2">
      {/* ─── ZUERST DIE BEIDEN, DIE MAN AM HÄUFIGSTEN WILL ─────────────
          Dreizehn Schalter einzeln umzulegen, nur um „zeig mir gerade mal
          gar nichts" zu sagen, wäre eine Zumutung auf einem Bildschirm im
          Fahrerhaus. */}
      <div className="flex gap-1">
        <button
          type="button"
          onClick={() => setPoiAus([])}
          disabled={poiAus.length === 0}
          data-testid="poi-kategorie-alle"
          className="flex-1 px-2 py-1 rounded-md border border-slate-300 dark:border-slate-600 text-xs disabled:opacity-40"
        >
          Alle an
        </button>
        <button
          type="button"
          onClick={() => setPoiAus(POI_AUSWAHL.map((e) => e.schluessel))}
          disabled={alleAus}
          data-testid="poi-kategorie-keine"
          className="flex-1 px-2 py-1 rounded-md border border-slate-300 dark:border-slate-600 text-xs disabled:opacity-40"
        >
          Alle aus
        </button>
      </div>

      <ul className="space-y-0.5">
        {POI_AUSWAHL.map((eintrag) => {
          const an = !poiAus.includes(eintrag.schluessel);
          return (
            <li key={eintrag.schluessel}>
              {/* Ein echtes `<label>` mit Kontrollkästchen und nicht ein
                  angeklickter `<div>`: die Trefferfläche wird damit die ganze
                  Zeile, und das zählt auf einem wackelnden Bildschirm mehr
                  als das Aussehen. */}
              <label className="flex items-center gap-2 px-2 py-1.5 rounded-md hover:bg-slate-100 dark:hover:bg-slate-700 cursor-pointer">
                <input
                  type="checkbox"
                  checked={an}
                  onChange={(e) => setPoiKategorie(eintrag.schluessel, e.target.checked)}
                  data-testid={`poi-kategorie-${eintrag.schluessel}`}
                  className="h-4 w-4 shrink-0 accent-blue-600"
                />
                <span className={`text-xs ${an ? '' : 'text-slate-400 dark:text-slate-500'}`}>
                  {eintrag.name}
                </span>
              </label>
            </li>
          );
        })}
      </ul>

      {/* ─── WARUM DIESER SATZ DASTEHT ──────────────────────────────────
          Vier der dreizehn Kategorien kommen nicht aus den Kacheln, sondern
          aus dem Suchindex — das OpenMapTiles-Schema kennt sie schlicht
          nicht (siehe `poi/fehlendeKlassen.ts`). Wer keinen Index gebaut
          hat, legt ihren Schalter um und sieht: nichts ändert sich.

          Ohne diesen Hinweis ist ein Schalter ohne Daten von einem kaputten
          Schalter nicht zu unterscheiden. */}
      <p className="text-[11px] leading-snug text-slate-500 dark:text-slate-400">
        Entsorgung, Frischwasser, Müll und Dusche stammen aus dem Suchindex.
        Ohne gebauten Index bleiben sie leer — auch eingeschaltet.
      </p>
    </div>
  );
}

export default function StylePanel(): React.ReactElement {
  const [isOpen, setIsOpen] = useState(false);
  const schmal = useSchmal();
  const driveActive = isDriveActive(useNavStore((state) => state.navState)?.status);
  const [styles, setStyles] = useState<StyleSummary[]>([]);
  const styleId = useStyleStore((state) => state.styleId);
  const options = useStyleStore((state) => state.options);
  const setStyleId = useStyleStore((state) => state.setStyleId);
  const setLang = useStyleStore((state) => state.setLang);
  const setLabelScale = useStyleStore((state) => state.setLabelScale);
  const setPoi = useStyleStore((state) => state.setPoi);
  const reopenOnboardingWizard = useOnboardingStore((state) => state.reopen);

  useEffect(() => {
    if (!isOpen || styles.length > 0) {
      return;
    }
    let cancelled = false;
    void fetchStyleSummaries().then((summaries) => {
      if (!cancelled) {
        setStyles(summaries);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [isOpen, styles.length]);

  const toggleOpen = useCallback(() => setIsOpen((open) => !open), []);

  // Bottom-left is the one corner MapLibre's own NavigationControl (top-right,
  // added in MapView) and the other map FABs (compass/view-mode/re-center,
  // all bottom-right, plus the "Yapaia Go" header badge top-left) don't use —
  // avoids a pointer-event-intercepting overlap with any of them.
  return (
    // Waehrend einer Fahrt liegt auf schmalen Schirmen unten die
    // Fahrtdaten-Leiste ueber die ganze Breite -- der Knopf muss darueber.
    <div className="fixed left-4 z-10" style={{ bottom: bottomInsetPx(schmal, driveActive) }}>
      {isOpen && (
        <div
          className="absolute bottom-14 left-0 mb-2 w-64 max-h-[calc(100vh-7rem)] overflow-y-auto overscroll-contain rounded-xl bg-white/95 dark:bg-slate-800/95 shadow-xl p-4 text-sm text-slate-800 dark:text-slate-100 space-y-4"
          data-testid="style-panel"
        >
          {/* Speed-Lock (E07-T4): Settings is one of docs/06 §4's "complex
              dialogs" gated above the configured threshold -- the FAB above
              still opens this panel while locked, so the "Ich bin
              Beifahrer" override stays reachable, only the settings CONTENT
              itself is replaced by the overlay. */}
          <DriveLockGate controlId="settings">

          {/* ─── ZUERST: DER GRUND, AUS DEM MAN DIESES MENUE OEFFNET ──────
              Vorher stand der Kartenstil an vierter Stelle, unter Theme,
              Haendigkeit und Region. Was man am haeufigsten braucht, gehoert
              dorthin, wo der Blick zuerst hinfaellt. */}
          <FaltAbschnitt titel="Kartenstil" offen id="stil">
            <div className="flex flex-col gap-1">
              {styles.map((style) => (
                <button
                  key={style.id}
                  onClick={() => setStyleId(style.id)}
                  aria-pressed={style.id === styleId}
                  data-testid={`style-option-${style.id}`}
                  className={`text-left px-3 py-2 rounded-lg border ${
                    style.id === styleId
                      ? 'border-blue-500 bg-blue-50 dark:bg-blue-900/40 font-semibold'
                      : 'border-transparent hover:bg-slate-100 dark:hover:bg-slate-700'
                  }`}
                >
                  {style.name}
                </button>
              ))}
            </div>
          </FaltAbschnitt>

          {/* ─── HIER STAND „ANGEZEIGTE REGION" ────────────────────────────
              Entfernt in 0.16.0. Gewünscht:

                „Der Anwender soll immer alles angezeigt bekommen was er
                 runtergeladen hat. […] Auch die Auswahl der Region ist dann
                 unnötig da ja immer alles angezeigt wird."

              Die Auswahl konnte nur eines: die Karte auf EINE Region
              verkleinern. Ihr bester Zustand war „unberührt" — und ein
              Bedienelement, für das das gilt, gehört weg und nicht in ein
              Untermenü.

              Ohne sie schickt `MapView` gar keine Region mehr mit, und der
              Kern zeichnet alle installierten (siehe `rewriteToRegions`).
              Dass das so bleibt, hält `alleRegionen.test.ts` fest. */}

          {/* ─── DARSTELLUNG: WAS MAN EINMAL EINSTELLT ─────────────────────
              Hell/Dunkel, Sprache, Schriftgroesse, POI-Dichte. Zusammen vier
              Abschnitte, die vorher einzeln untereinander standen und den
              Platz dessen einnahmen, was man taeglich braucht.

              Zugeklappt kosten sie eine Zeile statt vierzehn. */}
          <FaltAbschnitt titel="Darstellung" offen={false} id="darstellung">
            <div className="space-y-3">
              <ThemeToggle />

              <div>
                <h3 className="mb-1 text-xs font-semibold text-slate-500 dark:text-slate-400">
                  Sprache der Labels
                </h3>
            <div className="flex gap-1 flex-wrap">
              {LANG_OPTIONS.map((opt) => (
                <button
                  key={opt.value}
                  onClick={() => setLang(opt.value)}
                  aria-pressed={opt.value === options.lang}
                  data-testid={`lang-option-${opt.value}`}
                  className={`px-2 py-1 rounded-md border text-xs ${
                    opt.value === options.lang
                      ? 'border-blue-500 bg-blue-50 dark:bg-blue-900/40 font-semibold'
                      : 'border-slate-300 dark:border-slate-600'
                  }`}
                >
                  {opt.label}
                </button>
                  ))}
                </div>
              </div>

              <div>
                <h3 className="mb-1 text-xs font-semibold text-slate-500 dark:text-slate-400">
                  Label-Größe
                </h3>
                <div className="flex gap-1">
              {LABEL_SCALE_OPTIONS.map((opt) => (
                <button
                  key={opt.value}
                  onClick={() => setLabelScale(opt.value)}
                  aria-pressed={opt.value === options.labelScale}
                  data-testid={`labelscale-option-${opt.value}`}
                  className={`px-2 py-1 rounded-md border text-xs ${
                    opt.value === options.labelScale
                      ? 'border-blue-500 bg-blue-50 dark:bg-blue-900/40 font-semibold'
                      : 'border-slate-300 dark:border-slate-600'
                  }`}
                >
                  {opt.label}
                </button>
                  ))}
                </div>
              </div>

              <div>
                {/* ─── „DICHTE" IST EINE FRAGE AN DAS GERAET ──────────────
                    Nicht an den Fahrer. Sie bleibt, weil die
                    Leistungsueberwachung sie bei niedriger Bildrate
                    herunterdreht -- welche Kategorien man sehen WILL, steht
                    jetzt einen Abschnitt tiefer unter „Sonderziele". */}
                <h3 className="mb-1 text-xs font-semibold text-slate-500 dark:text-slate-400">
                  POI-Dichte
                </h3>
                <div className="flex gap-1">
              {POI_OPTIONS.map((opt) => (
                <button
                  key={opt.value}
                  onClick={() => setPoi(opt.value)}
                  aria-pressed={opt.value === options.poi}
                  data-testid={`poi-option-${opt.value}`}
                  className={`px-2 py-1 rounded-md border text-xs ${
                    opt.value === options.poi
                      ? 'border-blue-500 bg-blue-50 dark:bg-blue-900/40 font-semibold'
                      : 'border-slate-300 dark:border-slate-600'
                  }`}
                >
                  {opt.label}
                </button>
                  ))}
                </div>
              </div>
            </div>
          </FaltAbschnitt>

          {/* ─── SONDERZIELE: WAS MAN AUF DER KARTE SEHEN WILL ────────────
              Gewünscht:

                „Kann ich die einzelnen sonderziele auch an und abschalten?
                 Zapfstellen brauche ich eher selten und dann stören sie
                 bspw."

              Ein eigener Abschnitt und nicht bei der Dichte darunter: die
              Dichte ist eine Frage an das Gerät, diese Liste eine an den
              Fahrer. Zugeklappt, weil man sie einmal einstellt -- aber als
              eigene Zeile sichtbar, denn bisher war „POI-Dichte" das
              einzige, was danach aussah, und es war die falsche Antwort. */}
          <FaltAbschnitt titel="Sonderziele" offen={false} id="sonderziele">
            <SonderzielSchalter />
          </FaltAbschnitt>

          {/* ─── GERAET: WAS MAN EINMAL IM LEBEN EINSTELLT ─────────────────
              Links-/Rechtshaendigkeit und der Setup-Assistent. Beides stellt
              man bei der Einrichtung ein und danach nie wieder — sie standen
              trotzdem dauerhaft im Bild.

              E08-T5: "wieder aufrufbar aus Settings" -- reopens the
              first-run onboarding wizard on demand (e.g. to redo the
              disclaimer, change GPS source, or set up MQTT later).
              `reopen()` shows the wizard WITHOUT touching the persisted
              `onboarding_state.completed` flag until the user actually
              finishes it again -- see `onboarding/store.ts`. */}
          <FaltAbschnitt titel="Gerät" offen={false} id="geraet">
            <div className="space-y-3">
              <HandednessToggle />
              <button
              type="button"
              onClick={() => reopenOnboardingWizard()}
              className="w-full px-3 py-2 rounded-md border border-slate-300 dark:border-slate-600 text-left hover:bg-slate-100 dark:hover:bg-slate-700 text-xs"
              data-testid="onboarding-reopen-button"
            >
              🧭 Setup-Assistent erneut öffnen
              </button>
            </div>
          </FaltAbschnitt>
          </DriveLockGate>
        </div>
      )}

      <button
        onClick={toggleOpen}
        className="w-12 h-12 rounded-full bg-white/90 dark:bg-slate-800/90 shadow-lg hover:shadow-xl transition-shadow flex items-center justify-center focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 dark:focus:ring-offset-slate-900 text-lg"
        aria-label="Karten-Einstellungen"
        aria-expanded={isOpen}
        title="Karten-Einstellungen"
        data-testid="style-panel-toggle"
      >
        ⚙️
      </button>
    </div>
  );
}
