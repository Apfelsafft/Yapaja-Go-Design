/**
 * Profile editor form (E06-T2).
 * Includes sliders + number inputs (coupled), toggles for avoid/hazmat,
 * live vehicle silhouette, and field-level error display.
 */

import React, { useState, useCallback } from 'react';
import type { VehicleProfile } from '@yapaia/shared';
import VehicleSilhouette from './VehicleSilhouette.js';
import {
  validateProfile,
  assessSuspiciousProfile,
  shouldShowHeightDisclaimer,
  RANGES, nachkommastellen } from './validation.js';
import { ProfileApiError } from './client.js';
import { useProfileStore } from './store.js';

interface ProfileEditorProps {
  profile: Partial<VehicleProfile>;
  onSave: (profile: Partial<VehicleProfile>) => Promise<void>;
  onCancel: () => void;
  isSaving?: boolean;
  apiErrors?: Record<string, string>;
}

interface DialogState {
  type: 'height-disclaimer' | 'suspicious-warning' | null;
  isVisible: boolean;
  profile?: Partial<VehicleProfile>;
}

export default function ProfileEditor({
  profile: initialProfile,
  onSave,
  onCancel,
  isSaving = false,
  apiErrors = {},
}: ProfileEditorProps): React.ReactElement {
  const [profile, setProfile] = useState<Partial<VehicleProfile>>(initialProfile);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [dialog, setDialog] = useState<DialogState>({ type: null, isVisible: false });

  const handleFieldChange = useCallback(
    (field: string, value: unknown) => {
      setProfile((prev) => ({ ...prev, [field]: value }));
      // Clear field error on change
      setFieldErrors((prev) => ({ ...prev, [field]: '' }));
    },
    [],
  );

  const handleNumericChange = useCallback(
    (field: string, value: string) => {
      const num = parseFloat(value);
      if (!Number.isNaN(num)) {
        handleFieldChange(field, num);
      }
    },
    [handleFieldChange],
  );

  const handleAvoidToggle = useCallback(
    (key: keyof VehicleProfile['avoid']) => {
      setProfile((prev) => {
        const avoid = prev.avoid ?? {
          motorway: false,
          toll: false,
          ferry: false,
          unpaved: false,
        };
        return {
          ...prev,
          avoid: {
            ...avoid,
            [key]: !avoid[key],
          },
        };
      });
    },
    [],
  );

  const confirmDimensions = useProfileStore((state) => state.confirmDimensions);

  /**
   * Dieses Formular IST die Stelle, an der ein Mensch die Fahrzeugmasse sieht.
   * Wer hier speichert, hat sie angeschaut -- auch wenn keine Zahl anders
   * wurde, weil sie stimmten. Genau das macht ein erfolgreiches Speichern zur
   * Bestaetigung im Sinne von `UnconfirmedDimensionsBanner`.
   *
   * Die strengere Regel im Core (nur ein GEAENDERTES Mass bestaetigt) bleibt
   * unberuehrt und wirkt weiter als Untergrenze fuer alles, was NICHT durch
   * dieses Formular kommt.
   *
   * Aufgefallen ist die Luecke am Onboarding-Test: der Assistent aendert im
   * Fahrzeug-Schritt nur den NAMEN -- danach stand der Dialog vor der frisch
   * eingerichteten App, obwohl der Betreiber die Masse gerade vor sich hatte.
   *
   * Scheitert die Bestaetigung, wird das bewusst geschluckt: das Profil ist
   * gespeichert, und ein Hinweis, der ein weiteres Mal erscheint, ist
   * harmloser als eine Fehlermeldung ueber einem erfolgreichen Speichern.
   */
  const confirmSavedDimensions = useCallback(async () => {
    const id = profile.id;
    if (!id) return;
    try {
      await confirmDimensions(id);
    } catch {
      /* siehe oben */
    }
  }, [profile.id, confirmDimensions]);

  const handleSave = useCallback(async () => {
    // Validate
    const validation = validateProfile(profile);
    if (!validation.isValid) {
      const errorMap: Record<string, string> = {};
      for (const error of validation.fieldErrors) {
        errorMap[error.field] = error.message;
      }
      setFieldErrors(errorMap);
      return;
    }

    // Merge API errors into field errors (if present)
    if (Object.keys(apiErrors).length > 0) {
      setFieldErrors(apiErrors);
    }

    // Check for height disclaimer (W-08)
    if (shouldShowHeightDisclaimer(profile)) {
      setDialog({
        type: 'height-disclaimer',
        isVisible: true,
        profile,
      });
      return;
    }

    // Proceed to save (skipping suspicious warning in this flow)
    try {
      await onSave(profile);
      await confirmSavedDimensions();
    } catch (err) {
      if (err instanceof ProfileApiError && err.details) {
        const fieldDetails = (err.details as Record<string, unknown>)?.fields as
          | Record<string, string>
          | undefined;
        if (fieldDetails) {
          setFieldErrors(fieldDetails);
        }
      }
    }
  }, [profile, apiErrors, onSave]);

  const handleDialogConfirm = useCallback(async () => {
    setDialog({ type: null, isVisible: false });

    if (dialog.profile) {
      try {
        await onSave(dialog.profile);
        await confirmSavedDimensions();
      } catch (err) {
        if (err instanceof ProfileApiError && err.details) {
          const fieldDetails = (err.details as Record<string, unknown>)?.fields as
            | Record<string, string>
            | undefined;
          if (fieldDetails) {
            setFieldErrors(fieldDetails);
          }
        }
      }
    }
  }, [dialog, onSave]);

  const handleDialogCancel = useCallback(() => {
    setDialog({ type: null, isVisible: false });
  }, []);

  const assessment = assessSuspiciousProfile(profile);

  return (
    <div className="space-y-6">
      {/* Name */}
      <div>
        <label htmlFor="name" className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">
          Profilname
        </label>
        <input
          id="name"
          type="text"
          value={profile.name ?? ''}
          onChange={(e) => handleFieldChange('name', e.target.value)}
          className="w-full px-3 py-2 border border-slate-300 dark:border-slate-600 rounded-md bg-white dark:bg-slate-700 text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-500"
          placeholder="z.B. Kastenwagen"
          data-testid="profile-name-input"
        />
        {fieldErrors['name'] && (
          <p className="mt-1 text-xs text-red-600 dark:text-red-400" data-testid="name-error">
            {fieldErrors['name']}
          </p>
        )}
      </div>

      {/* Live Silhouette */}
      <div>
        <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">
          Fahrzeug-Vorschau
        </label>
        <VehicleSilhouette
          height_m={profile.height_m}
          width_m={profile.width_m}
          length_m={profile.length_m}
        />
      </div>

      {/* Height */}
      <SliderInput
        label="Höhe (m)"
        value={profile.height_m ?? RANGES.height_m.min}
        min={RANGES.height_m.min}
        max={RANGES.height_m.max}
        step={RANGES.height_m.step}
        onChange={(v) => handleNumericChange('height_m', String(v))}
        error={fieldErrors['height_m']}
        testId="height-input"
      />

      {/* Width */}
      <SliderInput
        label="Breite (m)"
        value={profile.width_m ?? RANGES.width_m.min}
        min={RANGES.width_m.min}
        max={RANGES.width_m.max}
        step={RANGES.width_m.step}
        onChange={(v) => handleNumericChange('width_m', String(v))}
        error={fieldErrors['width_m']}
        testId="width-input"
      />

      {/* Length */}
      <SliderInput
        label="Länge (m)"
        value={profile.length_m ?? RANGES.length_m.min}
        min={RANGES.length_m.min}
        max={RANGES.length_m.max}
        step={RANGES.length_m.step}
        onChange={(v) => handleNumericChange('length_m', String(v))}
        error={fieldErrors['length_m']}
        testId="length-input"
      />

      {/* Weight */}
      <SliderInput
        label="Gewicht (t)"
        value={profile.weight_t ?? RANGES.weight_t.min}
        min={RANGES.weight_t.min}
        max={RANGES.weight_t.max}
        step={RANGES.weight_t.step}
        onChange={(v) => handleNumericChange('weight_t', String(v))}
        error={fieldErrors['weight_t']}
        testId="weight-input"
      />

      {/* Average speed */}
      <SliderInput
        label="Durchschnitt Geschwindigkeit (km/h)"
        value={profile.avg_speed_kmh ?? RANGES.avg_speed_kmh.min}
        min={RANGES.avg_speed_kmh.min}
        max={RANGES.avg_speed_kmh.max}
        step={RANGES.avg_speed_kmh.step}
        onChange={(v) => handleNumericChange('avg_speed_kmh', String(v))}
        error={fieldErrors['avg_speed_kmh']}
        testId="speed-input"
      />

      {/* Avoid toggles */}
      <div>
        <h3 className="text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">Vermeiden</h3>
        <div className="space-y-2">
          <ToggleInput
            label="Autobahnen"
            checked={profile.avoid?.motorway ?? false}
            onChange={() => handleAvoidToggle('motorway')}
            testId="avoid-motorway"
          />
          <ToggleInput
            label="Mautstraßen"
            checked={profile.avoid?.toll ?? false}
            onChange={() => handleAvoidToggle('toll')}
            testId="avoid-toll"
          />
          <ToggleInput
            label="Fähren"
            checked={profile.avoid?.ferry ?? false}
            onChange={() => handleAvoidToggle('ferry')}
            testId="avoid-ferry"
          />
          <ToggleInput
            label="Unbefestigte Straßen"
            checked={profile.avoid?.unpaved ?? false}
            onChange={() => handleAvoidToggle('unpaved')}
            testId="avoid-unpaved"
          />
        </div>
      </div>

      {/* Tempo-100-Zulassung */}
      <div>
        <ToggleInput
          label="Tempo-100-Zulassung"
          checked={profile.tempo_100 ?? false}
          onChange={() => handleFieldChange('tempo_100', !(profile.tempo_100 ?? false))}
          testId="tempo100-toggle"
        />
        {/* ─── WARUM HIER EIN SATZ STEHT UND NICHT NUR EIN SCHALTER ───────
            Weil die Angabe aus den FAHRZEUGPAPIEREN kommt und nicht aus dem
            Gefühl. Sie entscheidet bei einem Fahrzeug über 3,5 t, ob auf der
            Autobahn 80 oder 100 gilt — und danach richtet sich die
            Tempowarnung. Ein Häkchen ohne diesen Hinweis wäre eine Einladung
            zum Raten. */}
        <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
          Nur ankreuzen, wenn es in den Fahrzeugpapieren steht. Über 3,5 t
          entscheidet das über 80 oder 100 km/h auf der Autobahn — und damit
          über die Tempowarnung. Bis 3,5 t ändert es nichts.
        </p>
      </div>

      {/* Hazmat toggle */}
      <div>
        <ToggleInput
          label="Gefahrengut"
          checked={profile.hazmat ?? false}
          onChange={() => handleFieldChange('hazmat', !(profile.hazmat ?? false))}
          testId="hazmat-toggle"
        />
      </div>

      {/* Suspicious warning */}
      {assessment.warnings.length > 0 && (
        <div
          className="p-3 bg-amber-50 dark:bg-amber-900/30 border border-amber-200 dark:border-amber-700 rounded-md text-sm text-amber-800 dark:text-amber-200"
          data-testid="suspicious-warning"
        >
          {assessment.warnings.map((warning, idx) => (
            <p key={idx}>{warning}</p>
          ))}
        </div>
      )}

      {/* Action buttons */}
      <div className="flex gap-2 justify-end pt-4">
        <button
          onClick={onCancel}
          disabled={isSaving}
          className="px-4 py-2 rounded-md border border-slate-300 dark:border-slate-600 text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700/50 disabled:opacity-50"
          data-testid="cancel-button"
        >
          Abbrechen
        </button>
        <button
          onClick={handleSave}
          disabled={isSaving}
          className="px-4 py-2 rounded-md bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50"
          data-testid="save-button"
        >
          {isSaving ? 'Speichern...' : 'Speichern'}
        </button>
      </div>

      {/* Height Disclaimer Dialog (W-08) */}
      {dialog.type === 'height-disclaimer' && dialog.isVisible && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50" data-testid="height-disclaimer-dialog">
          <div className="bg-white dark:bg-slate-800 rounded-lg shadow-lg max-w-md p-6 space-y-4">
            <h2 className="text-lg font-semibold text-slate-900 dark:text-white">
              Höhenwarnung (W-08)
            </h2>
            <p className="text-sm text-slate-700 dark:text-slate-300">
              Dieses Fahrzeug ist höher als 2,7 m. Beachte: Das Navigationssystem kann physisch
              nicht garantieren, dass die OpenStreetMap-Daten vollständig sind. Höhen- und
              Gewichtslimits können fehlen. Überprüfe Fahrerhinweise und lokale Vorschriften
              selbst.
            </p>
            <div className="flex gap-2 justify-end">
              <button
                onClick={handleDialogCancel}
                className="px-3 py-2 rounded-md border border-slate-300 dark:border-slate-600 text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700/50"
                data-testid="disclaimer-cancel-button"
              >
                Zurück bearbeiten
              </button>
              <button
                onClick={handleDialogConfirm}
                className="px-3 py-2 rounded-md bg-blue-600 text-white hover:bg-blue-700"
                data-testid="disclaimer-confirm-button"
              >
                Verstanden, speichern
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * Reusable slider + number input pair
 */
interface SliderInputProps {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (value: number) => void;
  error?: string;
  testId: string;
}

function SliderInput({
  label,
  value,
  min,
  max,
  step,
  onChange,
  error,
  testId,
}: SliderInputProps): React.ReactElement {
  // ─── WARUM DAS ZAHLENFELD EINEN EIGENEN ENTWURF BRAUCHT ──────────────────
  // Gemeldet: „Man kann keine Werte über die Tastatur eingeben."
  //
  // Das Feld hing direkt am Wert und zeigte ihn mit `toFixed(2)`. Damit
  // wurde bei JEDEM Tastendruck neu formatiert: wer „3.49" tippen will,
  // erzeugt unterwegs „3." -- das ergibt geparst 3, und das Feld schrieb
  // daraufhin „3.00" zurueck, mitten in die Eingabe hinein. Die naechste
  // Ziffer landete an der falschen Stelle.
  //
  // Ein Feld, das dem Tippenden ins Wort faellt, ist nicht bedienbar. Solange
  // getippt wird, gilt deshalb der ENTWURF; erst beim Verlassen des Feldes
  // wird wieder formatiert.
  const [entwurf, setEntwurf] = React.useState<string | null>(null);
  const stellen = nachkommastellen(step);
  const angezeigt = entwurf ?? value.toFixed(stellen);

  return (
    <div>
      <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">
        {label}
      </label>
      <div className="flex gap-2 items-center">
        <input
          type="range"
          min={min}
          max={max}
          step={step}
          value={value}
          onChange={(e) => {
            // Der Regler hat immer einen gueltigen Wert -- ein Entwurf aus
            // dem Zahlenfeld daneben waere danach veraltet.
            setEntwurf(null);
            onChange(parseFloat(e.target.value));
          }}
          aria-label={label}
          className="flex-1 h-2 bg-slate-200 dark:bg-slate-700 rounded-lg appearance-none cursor-pointer"
          data-testid={`${testId}-slider`}
        />
        <input
          type="number"
          min={min}
          max={max}
          step={step}
          value={angezeigt}
          onChange={(e) => {
            const roh = e.target.value;
            setEntwurf(roh);
            const zahl = parseFloat(roh);
            // Ein halb getippter Wert („3.", „-", leer) ergibt NaN. Ihn
            // weiterzureichen hiesse, das Profil mit einer Unzahl zu fuellen;
            // er bleibt deshalb im Entwurf stehen, bis er eine Zahl ist.
            if (!Number.isNaN(zahl)) onChange(zahl);
          }}
          onBlur={() => setEntwurf(null)}
          aria-label={label}
          // Breiter als vorher: „3.49" plus die Pfeilchen des Browsers
          // passten in `w-16` nicht mehr.
          className="w-20 px-2 py-1 border border-slate-300 dark:border-slate-600 rounded-md bg-white dark:bg-slate-700 text-slate-900 dark:text-slate-100 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          data-testid={`${testId}-number`}
        />
      </div>
      {error && (
        <p className="mt-1 text-xs text-red-600 dark:text-red-400" data-testid={`${testId}-error`}>
          {error}
        </p>
      )}
    </div>
  );
}

/**
 * Reusable toggle (checkbox)
 */
interface ToggleInputProps {
  label: string;
  checked: boolean;
  onChange: () => void;
  testId: string;
}

function ToggleInput({ label, checked, onChange, testId }: ToggleInputProps): React.ReactElement {
  return (
    <label className="flex items-center gap-2 cursor-pointer">
      <input
        type="checkbox"
        checked={checked}
        onChange={onChange}
        className="w-4 h-4 rounded border-slate-300 dark:border-slate-600 text-blue-600"
        data-testid={testId}
      />
      <span className="text-sm text-slate-700 dark:text-slate-300">{label}</span>
    </label>
  );
}
