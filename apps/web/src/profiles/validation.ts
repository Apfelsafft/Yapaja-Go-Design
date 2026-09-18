/**
 * Profile validation and assessment logic (E06-T2).
 * Handles value ranges, field-level validation, and suspicious profile detection.
 */

import type { VehicleProfile } from '@yapaia/shared';

/**
 * Was sich einstellen laesst -- und in welcher Feinheit.
 *
 * ─── DAS GEWICHT STAND AUF 0,1 t, UND DAS WAR ZU GROB ──────────────────────
 * Gemeldet: „Mein Womo wiegt 3,49to. Was man nur durch die schieberegler
 * nicht einstellen kann. […] die Regler gehen in 10er Schritten."
 *
 * Das ist nicht nur unbequem. Bei 3,5 t liegt die Grenze, an der sich die
 * zulaessigen Hoechstgeschwindigkeiten aendern (siehe
 * `apps/core/src/routing/fahrzeugTempo.ts`). Mit 0,1er-Schritten waehlt
 * jemand mit 3,55 t naheliegend 3,5 -- und bekommt damit die Grenzen der
 * LEICHTEREN Klasse. Das ist die gefaehrliche Richtung: zu schnell erlaubt.
 *
 * 0,01 t sind zehn Kilogramm. Das ist die Feinheit, in der ein Fahrzeugschein
 * die zulaessige Gesamtmasse ausweist, und dieselbe, die Hoehe, Breite und
 * Laenge hier schon immer hatten.
 */
export const RANGES = {
  height_m: { min: 1.0, max: 4.5, step: 0.01 },
  width_m: { min: 1.5, max: 3.0, step: 0.01 },
  length_m: { min: 3.0, max: 20.0, step: 0.01 },
  weight_t: { min: 1.0, max: 40.0, step: 0.01 },
  avg_speed_kmh: { min: 40, max: 130, step: 1 },
} as const;

/**
 * Wie viele Nachkommastellen zu einer Schrittweite gehoeren.
 *
 * ─── WARUM DAS HIER STEHT UND NICHT IN DER KOMPONENTE ──────────────────────
 * Es ist eine Regel ueber die Schrittweiten oben, keine Darstellung. In einem
 * React-Baustein waere sie nur noch im Browser zu erreichen -- und eine
 * Pruefung dafuer muesste die ganze Komponente samt React laden, um eine
 * Zeichenkette zu zaehlen.
 *
 * Das Zahlenfeld rundete fest auf zwei Stellen. Bei der
 * Durchschnittsgeschwindigkeit (Schritt 1) stand damit „80.00" da -- eine
 * Genauigkeit, die die Zahl gar nicht hat.
 */
export function nachkommastellen(step: number): number {
  if (!Number.isFinite(step) || step <= 0) return 0;
  const text = String(step);
  const punkt = text.indexOf('.');
  return punkt < 0 ? 0 : text.length - punkt - 1;
}

export interface FieldError {
  field: keyof Omit<VehicleProfile, 'id' | 'is_active' | 'avoid' | 'hazmat'>;
  message: string;
}

export interface ValidationResult {
  isValid: boolean;
  fieldErrors: FieldError[];
}

export interface SuspiciousAssessment {
  warnings: string[];
}

/**
 * Validates a profile's numeric ranges and required fields.
 * Returns field-level errors if validation fails.
 */
export function validateProfile(profile: Partial<VehicleProfile>): ValidationResult {
  const fieldErrors: FieldError[] = [];

  // Name is required and non-empty
  if (!profile.name || profile.name.trim() === '') {
    fieldErrors.push({ field: 'name', message: 'Name darf nicht leer sein' });
  }

  // Numeric ranges
  const rangeChecks: Array<{ field: keyof typeof RANGES; value: unknown }> = [
    { field: 'height_m', value: profile.height_m },
    { field: 'width_m', value: profile.width_m },
    { field: 'length_m', value: profile.length_m },
    { field: 'weight_t', value: profile.weight_t },
    { field: 'avg_speed_kmh', value: profile.avg_speed_kmh },
  ];

  for (const { field, value } of rangeChecks) {
    if (value === null || value === undefined) {
      fieldErrors.push({ field, message: `${field} ist erforderlich` });
      continue;
    }

    const numValue = Number(value);
    if (Number.isNaN(numValue)) {
      fieldErrors.push({ field, message: `${field} muss eine Zahl sein` });
      continue;
    }

    const range = RANGES[field];
    if (numValue < range.min || numValue > range.max) {
      fieldErrors.push({
        field,
        message: `${field} muss zwischen ${range.min} und ${range.max} liegen`,
      });
    }
  }

  return {
    isValid: fieldErrors.length === 0,
    fieldErrors,
  };
}

/**
 * Assess a profile for suspicious or unusual characteristics.
 * Pure function, tabellengetrieben (table-driven) for testability.
 * Returns warnings (not errors) — the UI shows these but doesn't block saving.
 */
export function assessSuspiciousProfile(profile: Partial<VehicleProfile>): SuspiciousAssessment {
  const warnings: string[] = [];

  // Heuristic: height < 1.8 m AND weight > 3.0 t suggests a car profile
  // in a camper/motorhome app
  const height = profile.height_m;
  const weight = profile.weight_t;

  if (
    typeof height === 'number' &&
    typeof weight === 'number' &&
    height < 1.8 &&
    weight > 3.0
  ) {
    warnings.push(
      'Ungewöhnliche Kombination: Fahrzeug unter 1,8 m Höhe aber über 3,0 t Gewicht. Sicher?',
    );
  }

  return { warnings };
}

/**
 * Whether to show the W-08 disclaimer dialog.
 * Disclaimer is shown when height_m > 2.7 (higher than standard overpasses
 * in many regions).
 */
export function shouldShowHeightDisclaimer(profile: Partial<VehicleProfile>): boolean {
  return typeof profile.height_m === 'number' && profile.height_m > 2.7;
}
