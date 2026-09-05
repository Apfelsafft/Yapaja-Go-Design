/**
 * „Hat ein Mensch diese Masse je bestaetigt?" (Migration 005).
 *
 * ─── DER FEHLER, DEN DAS VERHINDERN SOLL ────────────────────────────────────
 * Beim ersten Start entsteht ein Profil „Camper" mit `height_m: 3.0`. Diese
 * Zahl ist geraten -- die Anwendung kann das Fahrzeug nicht kennen. Sie ging
 * aber ununterscheidbar von einer gemessenen Zahl als `height` an Valhalla.
 *
 * Und der Weg dorthin war offen: der Fahrzeug-Schritt des Assistenten ist
 * ueberspringbar (`isSkippable('profile')`), und die Navigation wird nur vom
 * Haftungshinweis freigeschaltet (`hasValidConsent`) -- ueber die Masse sagt
 * das nichts. Bei einem 3,20-m-Wohnmobil plant die Route dann mit 3,00 m.
 *
 * Geprueft wird deshalb nicht „das Feld existiert", sondern die Regel
 * dahinter: eine Bestaetigung entsteht NUR aus einer Handlung.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ProfileService, dimensionsDiffer, SAFETY_DIMENSIONS } from './service.js';
import { closeDb } from '../db/index.js';
import type { VehicleProfile } from '@yapaja/shared';

let dir: string;
let service: ProfileService;

beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), 'yapaja-dims-'));
  process.env.DB_PATH = join(dir, 'test.db');
  closeDb();
  service = new ProfileService();
  await service.init();
});

afterEach(() => {
  closeDb();
  rmSync(dir, { recursive: true, force: true });
});

function active(): VehicleProfile {
  const profile = service.getActive();
  if (!profile) throw new Error('kein aktives Profil');
  return profile;
}

describe('das ausgelieferte Standardprofil', () => {
  it('gilt als NICHT bestaetigt', () => {
    // Der Kern. Waere das ein Zeitstempel, behauptete die Datenbank, jemand
    // habe die 3,00 m geprueft -- niemand hat.
    expect(active().dimensions_confirmed_at).toBeNull();
  });

  it('hat geratene Masse, die trotzdem ans Routing gehen wuerden', () => {
    // Haelt die tatsaechliche Voreinstellung fest. Faellt dieser Test um,
    // weil jemand den Wert aendert, soll das auffallen: die Zahl entscheidet
    // im Zweifel ueber eine Bruecke.
    expect(active().height_m).toBe(3.0);
  });
});

describe('eine Bestaetigung entsteht nur aus einer Handlung', () => {
  it('„Masse stimmen" setzt den Zeitstempel', () => {
    const before = active();
    expect(before.dimensions_confirmed_at).toBeNull();

    const after = service.confirmDimensions(before.id);
    expect(after.dimensions_confirmed_at).not.toBeNull();
    // Und es haelt -- nicht nur im Rueckgabewert, sondern in der Datenbank.
    expect(service.getById(before.id)?.dimensions_confirmed_at).toBe(
      after.dimensions_confirmed_at,
    );
  });

  it('eine geaenderte Hoehe gilt als Bestaetigung', () => {
    const before = active();
    const after = service.update(before.id, { height_m: 3.2 });
    expect(after.height_m).toBe(3.2);
    expect(after.dimensions_confirmed_at).not.toBeNull();
  });

  it('ein umgeschalteter Faehren-Haken gilt NICHT als Bestaetigung', () => {
    // Der wichtigste negative Fall. Wer „Faehren meiden" antippt, hat die
    // Hoehe nicht geprueft -- ein Haken an anderer Stelle darf keine
    // Sicherheitsangabe erzeugen.
    const before = active();
    const after = service.update(before.id, {
      avoid: { motorway: false, toll: false, ferry: true, unpaved: false },
    });
    expect(after.avoid.ferry).toBe(true);
    expect(after.dimensions_confirmed_at).toBeNull();
  });

  it('ein mitgeschicktes, aber UNVERAENDERTES Mass bestaetigt nichts', () => {
    // Ein Formular, das einfach das ganze Profil zurueckschreibt, darf keine
    // Bestaetigung ausloesen, die niemand gegeben hat.
    const before = active();
    const after = service.update(before.id, {
      height_m: before.height_m,
      width_m: before.width_m,
      length_m: before.length_m,
      weight_t: before.weight_t,
      name: 'Anders benannt',
    });
    expect(after.name).toBe('Anders benannt');
    expect(after.dimensions_confirmed_at).toBeNull();
  });

  it('ein direkt mitgeschicktes dimensions_confirmed_at wird ignoriert', () => {
    const before = active();
    const after = service.update(before.id, {
      dimensions_confirmed_at: '2020-01-01T00:00:00.000Z',
    } as Partial<Omit<VehicleProfile, 'id' | 'is_active'>>);
    expect(after.dimensions_confirmed_at).toBeNull();
  });

  it('ein selbst angelegtes Profil ist bestaetigt -- die Masse wurden eingetippt', () => {
    const created = service.create({
      name: 'Alkoven',
      height_m: 3.2,
      width_m: 2.3,
      length_m: 7.5,
      weight_t: 3.5,
      avg_speed_kmh: 90,
      hazmat: false,
      avoid: { motorway: false, toll: false, ferry: false, unpaved: false },
      dimensions_confirmed_at: null,
    });
    // `null` mitgeschickt und trotzdem bestaetigt: der Wert des Aufrufers
    // zaehlt nicht, die Handlung zaehlt.
    expect(created.dimensions_confirmed_at).not.toBeNull();
  });
});

describe('welche Masse als Sicherheitsangabe gelten', () => {
  it('sind genau die vier, die Valhalla als physische Grenze bekommt', () => {
    expect([...SAFETY_DIMENSIONS]).toEqual(['height_m', 'width_m', 'length_m', 'weight_t']);
  });

  it('die Reisegeschwindigkeit gehoert NICHT dazu', () => {
    // Eine falsche Reisegeschwindigkeit macht die Ankunftszeit ungenau, nicht
    // die Route unbefahrbar. Sie darf deshalb keine Bestaetigung ausloesen.
    const before = active();
    const after = service.update(before.id, { avg_speed_kmh: 70 });
    expect(after.avg_speed_kmh).toBe(70);
    expect(after.dimensions_confirmed_at).toBeNull();
  });

  it('dimensionsDiffer erkennt jede einzelne der vier Abmessungen', () => {
    const base = active();
    for (const key of SAFETY_DIMENSIONS) {
      expect(dimensionsDiffer(base, { [key]: base[key] + 0.1 })).toBe(true);
      expect(dimensionsDiffer(base, { [key]: base[key] })).toBe(false);
    }
    expect(dimensionsDiffer(base, {})).toBe(false);
  });
});
