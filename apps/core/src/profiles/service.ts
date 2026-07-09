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
};

export interface ProfileServiceOptions {
  onProfileChanged?: (profile: VehicleProfile) => void;
}

export class ProfileService {
  private onProfileChanged?: (profile: VehicleProfile) => void;

  constructor(opts?: ProfileServiceOptions) {
    this.onProfileChanged = opts?.onProfileChanged;
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
   * Create a new profile (internally generated UUID, inert is_active=false)
   */
  create(input: Omit<VehicleProfile, 'id' | 'is_active'>): VehicleProfile {
    const id = randomUUID();
    const profile: VehicleProfile = {
      ...input,
      id,
      is_active: false,
    };
    this.insertProfile(profile);
    return profile;
  }

  /**
   * Update an existing profile (is_active cannot be changed via update)
   */
  update(id: string, input: Partial<Omit<VehicleProfile, 'id' | 'is_active'>>): VehicleProfile {
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
    };

    const row = profileToRow(updated);
    db.prepare(
      `UPDATE profiles SET name=?, height_m=?, width_m=?, length_m=?, weight_t=?, avg_speed_kmh=?,
       hazmat=?, avoid_motorway=?, avoid_toll=?, avoid_ferry=?, avoid_unpaved=? WHERE id=?`,
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
      id,
    );

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
  private insertProfile(profile: VehicleProfile): void {
    const db = getDb();
    const row = profileToRow(profile);
    db.prepare(
      `INSERT INTO profiles (id, name, height_m, width_m, length_m, weight_t, avg_speed_kmh,
       hazmat, avoid_motorway, avoid_toll, avoid_ferry, avoid_unpaved, is_active)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
    );
  }
}
