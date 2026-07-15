/**
 * FavoriteService: CRUD + reordering for favorite destinations (E05-T3,
 * docs/03 §2 "Favoriten").
 *
 * Mirrors `apps/core/src/profiles/service.ts`'s shape (row<->object mappers
 * from `../db/index.js`, a typed `FavoriteError` for HTTP-mappable failure
 * codes). The one invariant unique to favorites: category `home` may exist
 * at most once. Creating/updating a favorite into `home` while one already
 * exists is REJECTED by default (409 `HOME_ALREADY_EXISTS`, docs/03 "ersetzen
 * mit Bestätigung" -- confirmation is a UI concern); passing `replace: true`
 * atomically deletes the previous `home` favorite and installs the new one.
 */

import { randomUUID } from 'crypto';
import type { Favorite } from '@yapaja/shared';
import { getDb, rowToFavorite, favoriteToRow, type FavoriteRow } from '../db/index.js';

export class FavoriteError extends Error {
  code: string;

  constructor(code: string, message: string) {
    super(message);
    this.code = code;
    this.name = 'FavoriteError';
  }
}

export type FavoriteCreateInput = Omit<Favorite, 'id' | 'sort_order'> & { sort_order?: number };
export type FavoriteUpdateInput = Partial<Omit<Favorite, 'id'>>;

export interface FavoriteWriteOptions {
  /** When creating/updating into category 'home' and one already exists,
   *  `replace: true` atomically deletes the previous one instead of
   *  rejecting with `HOME_ALREADY_EXISTS`. */
  replace?: boolean;
}

export class FavoriteService {
  /** All favorites, ordered by `sort_order` ascending (drag order). */
  getAll(): Favorite[] {
    const db = getDb();
    const rows = db
      .prepare('SELECT * FROM favorites ORDER BY sort_order ASC, id ASC')
      .all() as FavoriteRow[];
    return rows.map(rowToFavorite);
  }

  getById(id: string): Favorite | null {
    const db = getDb();
    const row = db.prepare('SELECT * FROM favorites WHERE id = ?').get(id) as
      | FavoriteRow
      | undefined;
    return row ? rowToFavorite(row) : null;
  }

  /** Finds the current `home` favorite, if any. */
  findHome(): Favorite | null {
    const db = getDb();
    const row = db.prepare("SELECT * FROM favorites WHERE category = 'home'").get() as
      | FavoriteRow
      | undefined;
    return row ? rowToFavorite(row) : null;
  }

  create(input: FavoriteCreateInput, opts: FavoriteWriteOptions = {}): Favorite {
    const db = getDb();

    if (input.category === 'home') {
      const existingHome = this.findHome();
      if (existingHome && !opts.replace) {
        throw new FavoriteError(
          'HOME_ALREADY_EXISTS',
          'A "home" favorite already exists. Pass replace=true to replace it.',
        );
      }
    }

    const favorite: Favorite = {
      id: randomUUID(),
      name: input.name,
      latlng: input.latlng,
      icon: input.icon,
      category: input.category,
      sort_order: input.sort_order ?? this.nextSortOrder(),
    };

    const transaction = db.transaction(() => {
      if (favorite.category === 'home') {
        db.prepare("DELETE FROM favorites WHERE category = 'home'").run();
      }
      this.insertFavorite(favorite);
    });
    transaction();

    return favorite;
  }

  update(id: string, input: FavoriteUpdateInput, opts: FavoriteWriteOptions = {}): Favorite {
    const db = getDb();
    const existing = this.getById(id);
    if (!existing) {
      throw new FavoriteError('NOT_FOUND', `Favorite ${id} not found`);
    }

    const updated: Favorite = { ...existing, ...input, id: existing.id };

    if (updated.category === 'home') {
      const existingHome = this.findHome();
      if (existingHome && existingHome.id !== id && !opts.replace) {
        throw new FavoriteError(
          'HOME_ALREADY_EXISTS',
          'A "home" favorite already exists. Pass replace=true to replace it.',
        );
      }
    }

    const transaction = db.transaction(() => {
      if (updated.category === 'home') {
        db.prepare("DELETE FROM favorites WHERE category = 'home' AND id != ?").run(id);
      }
      const row = favoriteToRow(updated);
      db.prepare(
        'UPDATE favorites SET name=?, lat=?, lon=?, icon=?, category=?, sort_order=? WHERE id=?',
      ).run(row.name, row.lat, row.lon, row.icon, row.category, row.sort_order, id);
    });
    transaction();

    return updated;
  }

  delete(id: string): void {
    const db = getDb();
    const existing = this.getById(id);
    if (!existing) {
      throw new FavoriteError('NOT_FOUND', `Favorite ${id} not found`);
    }
    db.prepare('DELETE FROM favorites WHERE id = ?').run(id);
  }

  /**
   * Persists a new drag order: `ids` is the FULL, ordered list of favorite
   * ids. Each id's `sort_order` becomes its index in the array. Unknown ids
   * are ignored; ids not present in `ids` keep their previous `sort_order`
   * (defensive -- callers are expected to always pass the complete list).
   */
  reorder(ids: string[]): Favorite[] {
    const db = getDb();
    const transaction = db.transaction(() => {
      ids.forEach((id, index) => {
        db.prepare('UPDATE favorites SET sort_order = ? WHERE id = ?').run(index, id);
      });
    });
    transaction();
    return this.getAll();
  }

  private nextSortOrder(): number {
    const db = getDb();
    const row = db.prepare('SELECT MAX(sort_order) as maxOrder FROM favorites').get() as {
      maxOrder: number | null;
    };
    return row.maxOrder === null ? 0 : row.maxOrder + 1;
  }

  private insertFavorite(favorite: Favorite): void {
    const db = getDb();
    const row = favoriteToRow(favorite);
    db.prepare(
      'INSERT INTO favorites (id, name, lat, lon, icon, category, sort_order) VALUES (?, ?, ?, ?, ?, ?, ?)',
    ).run(row.id, row.name, row.lat, row.lon, row.icon, row.category, row.sort_order);
  }
}
