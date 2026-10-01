/**
 * Tempo-100-Zulassung und Spritsorte überleben das Speichern (Migration 006).
 *
 * Bis 0.21 stand `tempo_100` nie in der Tabelle: eingetragen, angezeigt --
 * und nach dem nächsten Laden weg.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { closeDb } from '../db/index.js';
import { ProfileService } from './service.js';

describe('Profil: Tempo 100 und Spritsorte werden gespeichert', () => {
  let dir: string;
  let service: ProfileService;

  beforeEach(async () => {
    dir = mkdtempSync(join(tmpdir(), 'yapaja-profil-'));
    process.env.DB_PATH = join(dir, 'test.db');
    service = new ProfileService();
    await service.init();
  });

  afterEach(() => {
    closeDb();
    rmSync(dir, { recursive: true, force: true });
  });

  it('der gemeldete Fall: Tempo 100 ist nach dem Neuladen noch da', () => {
    const aktiv = service.getAll()[0]!;
    service.update(aktiv.id, { tempo_100: true });
    expect(service.getById(aktiv.id)?.tempo_100).toBe(true);
  });

  it('die Spritsorte wird gespeichert und gelesen', () => {
    const aktiv = service.getAll()[0]!;
    service.update(aktiv.id, { fuel_type: 'diesel' });
    expect(service.getById(aktiv.id)?.fuel_type).toBe('diesel');
  });

  it('ohne Angabe bleibt die Spritsorte leer -- es wird nichts geraten', () => {
    const aktiv = service.getAll()[0]!;
    expect(service.getById(aktiv.id)?.fuel_type).toBeUndefined();
    expect(service.getById(aktiv.id)?.tempo_100).not.toBe(true);
  });

  it('„Nicht angegeben" (null) löscht eine frühere Sorte', () => {
    const aktiv = service.getAll()[0]!;
    service.update(aktiv.id, { fuel_type: 'diesel' });
    service.update(aktiv.id, { fuel_type: null });
    expect(service.getById(aktiv.id)?.fuel_type).toBeUndefined();
  });

  it('ein neues Profil behält beides', () => {
    const neu = service.create({
      name: 'Alkoven',
      height_m: 3.2,
      width_m: 2.3,
      length_m: 7.0,
      weight_t: 4.2,
      avg_speed_kmh: 85,
      hazmat: false,
      tempo_100: true,
      fuel_type: 'lpg',
      avoid: { motorway: false, toll: false, ferry: false, unpaved: false },
    });
    const gelesen = service.getById(neu.id)!;
    expect(gelesen.tempo_100).toBe(true);
    expect(gelesen.fuel_type).toBe('lpg');
  });
});
