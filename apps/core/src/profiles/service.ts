/**
 * ProfileService: CRUD operations and activation logic for vehicle profiles
 * Enforces single-active invariant via transactions
 */

import { randomUUID } from 'crypto';
import type { VehicleProfile } from '@yapaja/shared';
import { getDb, rowToProfile, profileToRow, type DatabaseRow } from '../db/index.js';

class ProfileError extends Error {
  code: string;

  constructor(code: string, message: string) {
    super(message);
    this.code = code;
    this.name = 'ProfileError';
  }
}

const DEFAULT_PROFILE_NAME = 'Camper';
const DEFAULT_PROFILE: Omit<VehicleProfile, 'id' | 'is_active'> = {
  name: DEFAULT_PROFILE_NAME,
  height_m: 3.0,
  width_m: 2.2,
  length_m: 6.5,
  weight_t: 3.5,
  avg_speed_kmh: 85,
  hazmat: false,
  avoid: {
    motorway: false,
    toll: false,
    ferry: false,
    unpaved: false,
  },
  // GERATEN, nicht gemessen -- die Anwendung kann das Fahrzeug nicht kennen.
  // `null` haelt genau das fest, damit die Oberflaeche es sagen kann, statt
  // eine Vermutung wie eine Angabe aussehen zu lassen (Migration 005).
  dimensions_confirmed_at: null,
};

/**
 * Die vier Masse, die ueber die BEFAHRBARKEIT einer Kante entscheiden.
 *
 * `avg_speed_kmh` gehoert bewusst NICHT dazu: eine falsche Reisegeschwindigkeit
 * macht die Ankunftszeit ungenau, nicht die Route unbefahrbar. Nur was
 * `buildTruckCostingOptions` an Valhalla als physische Grenze reicht, zaehlt
 * hier als Sicherheitsangabe.
 */
/**
 * Was ein Aufrufer an einem Profil setzen darf.
 *
 * `dimensions_confirmed_at` ist ausdrücklich AUSGESCHLOSSEN: „ein Mensch hat
 * die Masse bestaetigt" darf nur aus einer Handlung entstehen, nie daraus,
 * dass jemand ein Feld mitschickt. Das war vorher nur ein Kommentar und ein
 * Test -- jetzt sagt es der Typ, und ein Aufrufer kann es gar nicht erst
 * versuchen.
 */
export type ProfileInput = Omit<VehicleProfile, 'id' | 'is_active' | 'dimensions_confirmed_at'>;

export const SAFETY_DIMENSIONS = ['height_m', 'width_m', 'length_m', 'weight_t'] as const;

/** Wahr, wenn `input` mindestens eine der Abmessungen auf einen ANDEREN Wert
 *  setzt. Ein mitgeschickter, aber unveraenderter Wert zaehlt nicht -- sonst
 *  wuerde ein Aufrufer, der einfach das ganze Profil zurueckschickt, eine
 *  Bestaetigung ausloesen, die niemand gegeben hat. */
export function dimensionsDiffer(
  existing: VehicleProfile,
  input: Partial<ProfileInput>,
): boolean {
  return SAFETY_DIMENSIONS.some(
    (key) => input[key] !== undefined && input[key] !== existing[key],
  );
}

export interface ProfileServiceOptions {
  onProfileChanged?: (profile: VehicleProfile) => void;
  /**
   * E08-T2: fired whenever `create`/`update`/`delete` changes the SET of
   * profiles or a profile's `name` -- i.e. whenever
   * `select.yapaja_profile`'s HA discovery `options` (the live profile-name
   * list) would need re-publishing. Deliberately NOT fired from `activate()`
   * (that's `onProfileChanged` above): activating a profile never changes
   * the list of names, only which one is current.
   */
  onProfileListChanged?: () => void;
}

export class ProfileService {
  private onProfileChanged?: (profile: VehicleProfile) => void;
  private onProfileListChanged?: () => void;

  constructor(opts?: ProfileServiceOptions) {
    this.onProfileChanged = opts?.onProfileChanged;
    this.onProfileListChanged = opts?.onProfileListChanged;
  }

  /**
   * Initialize the service and create default profile if database is empty
   * Idempotent: calling multiple times is safe
   */
  async init(): Promise<void> {
    const db = getDb();
    const count = db.prepare('SELECT COUNT(*) as count FROM profiles').get() as { count: number };

    if (count.count === 0) {
      // Create default profile
      const defaultId = randomUUID();
      const defaultProfile: VehicleProfile = {
        id: defaultId,
        ...DEFAULT_PROFILE,
        is_active: true,
      };
      this.insertProfile(defaultProfile);
    }
  }

  /**
   * Get all profiles
   */
  getAll(): VehicleProfile[] {
    const db = getDb();
    const rows = db.prepare('SELECT * FROM profiles').all() as DatabaseRow[];
    return rows.map(rowToProfile);
  }

  /**
   * Get a profile by ID
   */
  getById(id: string): VehicleProfile | null {
    const db = getDb();
    const row = db.prepare('SELECT * FROM profiles WHERE id = ?').get(id) as DatabaseRow | undefined;
    return row ? rowToProfile(row) : null;
  }

  /**
   * Get the currently active profile (single-active invariant, see
   * `activate()`), or null if none is active yet (e.g. before `init()`).
   * Used by NavigationService (E04-T2) for the ETA `avg_speed_kmh` floor.
   */
  getActive(): VehicleProfile | null {
    const db = getDb();
    const row = db.prepare('SELECT * FROM profiles WHERE is_active = 1').get() as
      | DatabaseRow
      | undefined;
    return row ? rowToProfile(row) : null;
  }

  /**
   * Create a new profile (internally generated UUID, inert is_active=false)
   */
  create(input: ProfileInput): VehicleProfile {
    const id = randomUUID();
    const profile: VehicleProfile = {
      ...input,
      id,
      is_active: false,
      // Wer ein Profil anlegt, hat die Masse selbst eingetragen -- das IST
      // die Bestaetigung. Mitschicken kann man sie nicht (`ProfileInput`).
      dimensions_confirmed_at: new Date().toISOString(),
    };
    this.insertProfile(profile);
    this.onProfileListChanged?.();
    return profile;
  }

  /**
   * Update an existing profile (is_active cannot be changed via update)
   */
  update(id: string, input: Partial<ProfileInput>): VehicleProfile {
    const db = getDb();
    const existing = this.getById(id);
    if (!existing) {
      throw new Error(`Profile ${id} not found`);
    }

    const updated: VehicleProfile = {
      ...existing,
      ...input,
      id: existing.id,
      is_active: existing.is_active, // Prevent changing is_active
      // Eine GEAENDERTE Abmessung ist eine bewusste Angabe eines Menschen und
      // gilt damit als Bestaetigung. Ein blosses Umschalten von „Faehren
      // meiden" dagegen nicht -- wer das tut, hat die Hoehe nicht geprueft,
      // und ein Haken an der falschen Stelle darf keine Sicherheitsangabe
      // erzeugen. `dimensions_confirmed_at` aus `input` wird ignoriert.
      dimensions_confirmed_at: dimensionsDiffer(existing, input)
        ? new Date().toISOString()
        : existing.dimensions_confirmed_at,
    };

    const row = profileToRow(updated);
    db.prepare(
      `UPDATE profiles SET name=?, height_m=?, width_m=?, length_m=?, weight_t=?, avg_speed_kmh=?,
       hazmat=?, avoid_motorway=?, avoid_toll=?, avoid_ferry=?, avoid_unpaved=?,
       dimensions_confirmed_at=? WHERE id=?`,
    ).run(
      row.name,
      row.height_m,
      row.width_m,
      row.length_m,
      row.weight_t,
      row.avg_speed_kmh,
      row.hazmat,
      row.avoid_motorway,
      row.avoid_toll,
      row.avoid_ferry,
      row.avoid_unpaved,
      updated.dimensions_confirmed_at,
      id,
    );

    this.onProfileListChanged?.();
    return updated;
  }

  /**
   * Delete a profile by ID
   * Throws error if trying to delete the active profile
   */
  delete(id: string): void {
    const db = getDb();
    const profile = this.getById(id);
    if (!profile) {
      throw new Error(`Profile ${id} not found`);
    }

    if (profile.is_active) {
      throw new ProfileError('ACTIVE_PROFILE_UNDELETABLE', 'Cannot delete active profile');
    }

    db.prepare('DELETE FROM profiles WHERE id = ?').run(id);
    this.onProfileListChanged?.();
  }

  /**
   * Activate a profile (deactivates all others, runs in transaction)
   * Enforces single-active invariant
   */
  activate(id: string): VehicleProfile {
    const db = getDb();
    const profile = this.getById(id);
    if (!profile) {
      throw new Error(`Profile ${id} not found`);
    }

    // Transaction: deactivate all, activate this one
    const transaction = db.transaction(() => {
      db.prepare('UPDATE profiles SET is_active = 0').run();
      db.prepare('UPDATE profiles SET is_active = 1 WHERE id = ?').run(id);
    });

    transaction();

    const activated = this.getById(id)!;
    if (this.onProfileChanged) {
      this.onProfileChanged(activated);
    }
    return activated;
  }

  /**
   * Check database health
   */
  async checkHealth(): Promise<boolean> {
    try {
      const db = getDb();
      db.prepare('SELECT 1').get();
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Internal: insert a profile (used by create and init)
   */
  /**
   * „Die Masse stimmen so" -- die Antwort auf den Hinweis in der Oberflaeche,
   * ohne dass etwas geaendert werden muss.
   *
   * Es gibt bewusst KEIN Gegenstueck zum Zuruecknehmen: der Hinweis fragt
   * nach einer Tatsache ueber das Fahrzeug, und die aendert sich nur, wenn
   * sich das Fahrzeug aendert -- dann werden die Masse bearbeitet, und das
   * setzt den Zeitstempel ohnehin neu.
   */
  confirmDimensions(id: string): VehicleProfile {
    const db = getDb();
    const existing = this.getById(id);
    if (!existing) {
      throw new Error(`Profile ${id} not found`);
    }
    const confirmedAt = new Date().toISOString();
    db.prepare('UPDATE profiles SET dimensions_confirmed_at=? WHERE id=?').run(confirmedAt, id);
    const updated: VehicleProfile = { ...existing, dimensions_confirmed_at: confirmedAt };
    this.onProfileListChanged?.();
    return updated;
  }

  private insertProfile(profile: VehicleProfile): void {
    const db = getDb();
    const row = profileToRow(profile);
    db.prepare(
      `INSERT INTO profiles (id, name, height_m, width_m, length_m, weight_t, avg_speed_kmh,
       hazmat, avoid_motorway, avoid_toll, avoid_ferry, avoid_unpaved, is_active,
       dimensions_confirmed_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      row.id,
      row.name,
      row.height_m,
      row.width_m,
      row.length_m,
      row.weight_t,
      row.avg_speed_kmh,
      row.hazmat,
      row.avoid_motorway,
      row.avoid_toll,
      row.avoid_ferry,
      row.avoid_unpaved,
      row.is_active,
      profile.dimensions_confirmed_at,
    );
  }
}
