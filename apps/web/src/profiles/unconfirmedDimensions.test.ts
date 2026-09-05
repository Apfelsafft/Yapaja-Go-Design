/**
 * Wann der Hinweis erscheint, und was er sagt.
 *
 * Der Hinweis nennt die Masse ABSICHTLICH im Klartext -- „3,00 m hoch" ist bei
 * einem 3,20-m-Fahrzeug sofort als falsch zu erkennen, eine allgemeine
 * Warnung nicht. Deshalb wird hier auch die Formatierung geprueft und nicht
 * nur die Bedingung.
 */

import { describe, it, expect } from 'vitest';
import type { VehicleProfile } from '@yapaja/shared';
import { formatDimensions, needsDimensionConfirmation } from './unconfirmedDimensions.js';

function profile(overrides: Partial<VehicleProfile> = {}): VehicleProfile {
  return {
    id: 'p1',
    name: 'Camper',
    height_m: 3.0,
    width_m: 2.2,
    length_m: 6.5,
    weight_t: 3.5,
    avg_speed_kmh: 85,
    hazmat: false,
    avoid: { motorway: false, toll: false, ferry: false, unpaved: false },
    is_active: true,
    dimensions_confirmed_at: null,
    ...overrides,
  };
}

describe('wann der Hinweis noetig ist', () => {
  it('bei nie bestaetigten Massen', () => {
    expect(needsDimensionConfirmation(profile({ dimensions_confirmed_at: null }))).toBe(true);
  });

  it('nicht mehr, sobald bestaetigt wurde', () => {
    expect(
      needsDimensionConfirmation(profile({ dimensions_confirmed_at: '2026-09-05T10:00:00Z' })),
    ).toBe(false);
  });

  it('nicht, solange noch kein Profil geladen ist', () => {
    // Ein Hinweis, der beim Start kurz aufblitzt und wieder verschwindet,
    // wird als Fehler gelesen -- nicht als Warnung.
    expect(needsDimensionConfirmation(null)).toBe(false);
  });
});

describe('was im Hinweis steht', () => {
  it('nennt die Masse, mit denen wirklich geroutet wird', () => {
    const text = formatDimensions(profile());
    expect(text).toContain('3,00 m hoch');
    expect(text).toContain('2,20 m breit');
    expect(text).toContain('6,50 m lang');
    expect(text).toContain('3,5 t');
  });

  it('zeigt die Hoehe mit zwei Nachkommastellen', () => {
    // 3,2 statt 3,20 laedt dazu ein, es fuer 3,02 zu halten -- und der
    // Unterschied ist genau die Sorte Fehler, um die es hier geht.
    expect(formatDimensions(profile({ height_m: 3.2 }))).toContain('3,20 m hoch');
  });

  it('nutzt das Dezimalkomma, nicht den Punkt', () => {
    expect(formatDimensions(profile())).not.toContain('3.00');
  });
});
