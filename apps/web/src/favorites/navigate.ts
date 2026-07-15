/**
 * Starts a route to a favorite (E05-T3). Pulled out of the UI component so
 * the CRITICAL invariant below is independently unit-testable without
 * mounting React: a favorite route ALWAYS uses the vehicle profile that is
 * active at the moment of tapping the chip -- NEVER the profile that
 * happened to be active when the favorite was created (docs/03 §2
 * "Favoriten-Route nutzt IMMER aktuelles aktives Profil, nicht das bei
 * Anlage aktive").
 *
 * This holds structurally, not by convention: `Favorite` (see
 * `@yapaja/shared`) has no `profile_id` field at all -- there is nothing to
 * read the "creation-time profile" FROM. The active profile is read fresh
 * via `useProfileStore.getState()` on every call, exactly like
 * `RoutingPanel`'s "Route hierhin" button does for a searched/clicked
 * destination.
 */
import { useProfileStore } from '../profiles/store.js';
import { useRoutingStore } from '../routing/store.js';
import { useFavoritesStore } from './store.js';
import type { Favorite } from '@yapaja/shared';

/**
 * Sets the routing store's destination to `favorite` and immediately
 * requests a route using the CURRENTLY active profile (read at call time),
 * then records a history entry (best-effort, never throws).
 */
export async function navigateToFavorite(favorite: Favorite): Promise<void> {
  const { activeProfile } = useProfileStore.getState();

  useRoutingStore.getState().setDestination(favorite.latlng, favorite.name);

  void useFavoritesStore.getState().recordHistory({
    query: null,
    destination: { latlng: favorite.latlng, name: favorite.name },
  });

  await useRoutingStore.getState().requestRoute({
    origin: 'current',
    profileId: activeProfile?.id,
  });
}
