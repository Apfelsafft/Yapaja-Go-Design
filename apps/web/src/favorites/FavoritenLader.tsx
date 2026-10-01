/**
 * Lädt Favoriten und Verlauf beim Start -- unabhängig davon, ob etwas sie
 * gerade anzeigt.
 *
 * Bis 0.22 tat das nebenbei die Favoritenleiste am unteren Rand, die immer
 * montiert war. Seit 0.23 erscheinen Favoriten erst in der Suche -- und ohne
 * diesen Lader blieben das Fahrtmenü („Zwischenstopp einschieben") und die
 * Favoriten-Schnellwahl während der Fahrt leer, bis man einmal in die Suche
 * getippt hätte. Aufgefallen in `nav-control.spec.ts`.
 */

import { useEffect } from 'react';
import { useFavoritesStore } from './store.js';

export default function FavoritenLader(): null {
  const fetchFavorites = useFavoritesStore((s) => s.fetchFavorites);
  const fetchHistory = useFavoritesStore((s) => s.fetchHistory);
  useEffect(() => {
    void fetchFavorites();
    void fetchHistory();
  }, [fetchFavorites, fetchHistory]);
  return null;
}
