/**
 * Onboarding step 1: language/units (E08-T5). Writes straight to the
 * general-purpose settings store (`PATCH /api/v1/settings`, keys `units` /
 * `language`) -- the SAME store `theme`/`layouts`/`onboarding_state` use, no
 * bespoke endpoint. Persists on every change (best-effort, mirrors
 * `theme/themeClient.ts#patchServerThemeMode`) so a value picked here
 * survives even if the user closes the wizard early on a later step.
 */

import React, { useState } from 'react';

export type Units = 'metric' | 'imperial';
export type Language = 'de' | 'en';

function apiUrl(path: string): string {
  return `${import.meta.env.BASE_URL}${path}`;
}

async function patchSetting(key: string, value: unknown): Promise<void> {
  try {
    await fetch(apiUrl('api/v1/settings'), {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ [key]: value }),
    });
  } catch {
    // Best-effort -- offline is a normal operating mode for this app.
  }
}

export default function LanguageUnitsStep(): React.ReactElement {
  const [units, setUnits] = useState<Units>('metric');
  const [language, setLanguage] = useState<Language>('de');

  const handleUnitsChange = (value: Units): void => {
    setUnits(value);
    void patchSetting('units', value);
  };

  const handleLanguageChange = (value: Language): void => {
    setLanguage(value);
    void patchSetting('language', value);
  };

  return (
    <div className="space-y-6" data-testid="onboarding-step-language">
      <div>
        <h3 className="font-semibold mb-2">Sprache</h3>
        <div className="flex gap-2" role="group" aria-label="Sprache">
          {(
            [
              { value: 'de', label: 'Deutsch' },
              { value: 'en', label: 'English' },
            ] as const
          ).map((opt) => (
            <button
              key={opt.value}
              type="button"
              onClick={() => handleLanguageChange(opt.value)}
              aria-pressed={language === opt.value}
              className={
                language === opt.value
                  ? 'px-3 py-2 rounded-md bg-blue-600 text-white text-sm font-medium'
                  : 'px-3 py-2 rounded-md border border-slate-300 dark:border-slate-600 text-sm'
              }
              data-testid={`onboarding-language-${opt.value}`}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </div>

      <div>
        <h3 className="font-semibold mb-2">Einheiten</h3>
        <div className="flex gap-2" role="group" aria-label="Einheiten">
          {(
            [
              { value: 'metric', label: 'Metrisch (km, °C)' },
              { value: 'imperial', label: 'Imperial (mi, °F)' },
            ] as const
          ).map((opt) => (
            <button
              key={opt.value}
              type="button"
              onClick={() => handleUnitsChange(opt.value)}
              aria-pressed={units === opt.value}
              className={
                units === opt.value
                  ? 'px-3 py-2 rounded-md bg-blue-600 text-white text-sm font-medium'
                  : 'px-3 py-2 rounded-md border border-slate-300 dark:border-slate-600 text-sm'
              }
              data-testid={`onboarding-units-${opt.value}`}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
