/**
 * Style / Settings Panel (E01-T4, preliminary — docs/06-ui-ux-guidelines.md
 * §6): lets the user pick a map style (`Yapaja Light` / `Dark` / `Contrast`)
 * and the label language / label scale / POI density options. All choices
 * persist via `useStyleStore` (localStorage).
 *
 * This is a stand-in for the eventual Settings surface (widget system,
 * docs/06 §2) — deliberately minimal, just enough UI to exercise and
 * demonstrate the style system end-to-end.
 */

import React, { useCallback, useEffect, useState } from 'react';
import { useStyleStore } from '../state/styleStore';
import { fetchStyleSummaries, type StyleLabelScale, type StyleLang, type StylePoiDensity, type StyleSummary } from './styleClient';
import ThemeToggle from '../theme/ThemeToggle.js';
import DriveLockGate from '../drive/DriveLockGate.js';
import HandednessToggle from '../shell/HandednessToggle.js';
import { useOnboardingStore } from '../onboarding/store.js';
import { useRegionStore } from './regionStore.js';
import { pickActiveRegion } from './activeRegion.js';
import { usePosition } from '../position/positionStore.js';

const LANG_OPTIONS: Array<{ value: StyleLang; label: string }> = [
  { value: 'name', label: 'Original' },
  { value: 'name:de', label: 'Deutsch' },
  { value: 'name:en', label: 'English' },
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

export default function StylePanel(): React.ReactElement {
  const [isOpen, setIsOpen] = useState(false);
  const [styles, setStyles] = useState<StyleSummary[]>([]);
  const styleId = useStyleStore((state) => state.styleId);
  const options = useStyleStore((state) => state.options);
  const setStyleId = useStyleStore((state) => state.setStyleId);
  const setLang = useStyleStore((state) => state.setLang);
  const setLabelScale = useStyleStore((state) => state.setLabelScale);
  const setPoi = useStyleStore((state) => state.setPoi);
  const reopenOnboardingWizard = useOnboardingStore((state) => state.reopen);
  const installedRegions = useRegionStore((state) => state.regions);
  const manualRegion = useRegionStore((state) => state.manual);
  const setManualRegion = useRegionStore((state) => state.setManual);
  const position = usePosition();
  const activeRegionName =
    pickActiveRegion({ regions: installedRegions, point: position, manual: manualRegion }).region
      ?.region ?? null;

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
  // all bottom-right, plus the "Yapaja Go" header badge top-left) don't use —
  // avoids a pointer-event-intercepting overlap with any of them.
  return (
    <div className="fixed bottom-4 left-4 z-10">
      {isOpen && (
        <div
          className="absolute bottom-14 left-0 mb-2 w-64 rounded-xl bg-white/95 dark:bg-slate-800/95 shadow-xl p-4 text-sm text-slate-800 dark:text-slate-100 space-y-4"
          data-testid="style-panel"
        >
          {/* Speed-Lock (E07-T4): Settings is one of docs/06 §4's "complex
              dialogs" gated above the configured threshold -- the FAB above
              still opens this panel while locked, so the "Ich bin
              Beifahrer" override stays reachable, only the settings CONTENT
              itself is replaced by the overlay. */}
          <DriveLockGate controlId="settings">
          <ThemeToggle />

          <HandednessToggle />

          {/* ─── ANGEZEIGTE REGION ──────────────────────────────────────────
              Sichtbar nur mit mehr als einer installierten Region — bei einer
              einzigen gibt es nichts zu waehlen, und ein Bedienelement ohne
              Wirkung ist schlimmer als keines.

              „Automatisch" ist die Vorgabe und richtig: sie zeigt die Region,
              in der man sich befindet. Die feste Wahl ist fuer die Planung
              gedacht — eine Gegend aufschlagen, in der man gerade nicht ist.
              Sie ueberlebt einen Neustart absichtlich nicht (siehe
              regionStore.ts). */}
          {installedRegions.length > 1 && (
            <section>
              <h2 className="font-semibold mb-2">Angezeigte Region</h2>
              <div className="flex flex-col gap-1">
                <button
                  onClick={() => setManualRegion(null)}
                  aria-pressed={manualRegion === null}
                  data-testid="region-option-auto"
                  className={`text-left px-3 py-2 rounded-lg border text-xs ${
                    manualRegion === null
                      ? 'border-blue-500 bg-blue-50 dark:bg-blue-900/40 font-semibold'
                      : 'border-transparent hover:bg-slate-100 dark:hover:bg-slate-700'
                  }`}
                >
                  Automatisch
                  {activeRegionName !== null && manualRegion === null && (
                    <span className="block font-normal text-slate-500 dark:text-slate-400">
                      derzeit: {activeRegionName}
                    </span>
                  )}
                </button>
                {installedRegions.map((entry) => (
                  <button
                    key={entry.region}
                    onClick={() => setManualRegion(entry.region)}
                    aria-pressed={entry.region === manualRegion}
                    data-testid={`region-option-${entry.region}`}
                    className={`text-left px-3 py-2 rounded-lg border text-xs ${
                      entry.region === manualRegion
                        ? 'border-blue-500 bg-blue-50 dark:bg-blue-900/40 font-semibold'
                        : 'border-transparent hover:bg-slate-100 dark:hover:bg-slate-700'
                    }`}
                  >
                    {entry.region}
                  </button>
                ))}
              </div>
            </section>
          )}

          <section>
            <h2 className="font-semibold mb-2">Kartenstil</h2>
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
          </section>

          <section>
            <h2 className="font-semibold mb-2">Sprache der Labels</h2>
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
          </section>

          <section>
            <h2 className="font-semibold mb-2">Label-Größe</h2>
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
          </section>

          <section>
            <h2 className="font-semibold mb-2">POI-Dichte</h2>
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
          </section>

          {/* E08-T5: "wieder aufrufbar aus Settings" -- reopens the
              first-run onboarding wizard on demand (e.g. to redo the
              disclaimer, change GPS source, or set up MQTT later).
              `reopen()` shows the wizard WITHOUT touching the persisted
              `onboarding_state.completed` flag until the user actually
              finishes it again -- see `onboarding/store.ts`. */}
          <section>
            <h2 className="font-semibold mb-2">Einrichtung</h2>
            <button
              type="button"
              onClick={() => reopenOnboardingWizard()}
              className="w-full px-3 py-2 rounded-md border border-slate-300 dark:border-slate-600 text-left hover:bg-slate-100 dark:hover:bg-slate-700 text-xs"
              data-testid="onboarding-reopen-button"
            >
              🧭 Setup-Assistent erneut öffnen
            </button>
          </section>
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
