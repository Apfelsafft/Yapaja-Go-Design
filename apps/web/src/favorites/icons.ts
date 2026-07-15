/**
 * Category -> icon mapping for favorite chips (E05-T3). Plain emoji, same
 * lightweight approach as `search/icons.ts` -- no icon library dependency.
 */
import type { Favorite } from '@yapaja/shared';

const CATEGORY_ICONS: Record<Favorite['category'], string> = {
  home: '🏠',
  campsite: '⛺',
  poi: '📌',
  custom: '⭐',
};

export function iconForFavoriteCategory(category: Favorite['category']): string {
  return CATEGORY_ICONS[category] ?? '⭐';
}

export const FAVORITE_CATEGORIES: Favorite['category'][] = ['home', 'campsite', 'poi', 'custom'];

export const FAVORITE_CATEGORY_LABELS: Record<Favorite['category'], string> = {
  home: 'Zuhause',
  campsite: 'Stellplatz',
  poi: 'Sehenswürdigkeit',
  custom: 'Sonstiges',
};
