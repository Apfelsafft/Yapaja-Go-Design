/**
 * CRITICAL invariant test (E05-T3, docs/03 §2 plausibility bullet):
 * "Favoriten-Route nutzt IMMER aktuelles aktives Profil (nicht das bei
 * Anlage aktive)" -- a favorite route always uses the profile active AT TAP
 * TIME, never one captured/frozen when the favorite was created.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { Favorite, VehicleProfile } from '@yapaja/shared';

vi.mock('../routing/store.js', () => {
  const requestRoute = vi.fn().mockResolvedValue(undefined);
  const setDestination = vi.fn();
  return {
    useRoutingStore: { getState: () => ({ requestRoute, setDestination }) },
    __requestRoute: requestRoute,
    __setDestination: setDestination,
  };
});

vi.mock('../profiles/store.js', () => {
  let activeProfile: VehicleProfile | null = null;
  return {
    useProfileStore: {
      getState: () => ({ activeProfile }),
      __setActiveProfile: (p: VehicleProfile | null) => {
        activeProfile = p;
      },
    },
  };
});

vi.mock('./store.js', () => {
  const recordHistory = vi.fn().mockResolvedValue(undefined);
  return {
    useFavoritesStore: { getState: () => ({ recordHistory }) },
    __recordHistory: recordHistory,
  };
});

import { navigateToFavorite } from './navigate.js';
import * as routingStoreModule from '../routing/store.js';
import * as profileStoreModule from '../profiles/store.js';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const requestRouteMock = (routingStoreModule as any).__requestRoute as ReturnType<typeof vi.fn>;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const setDestinationMock = (routingStoreModule as any).__setDestination as ReturnType<typeof vi.fn>;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const setActiveProfile = (profileStoreModule.useProfileStore as any).__setActiveProfile as (
  p: VehicleProfile | null,
) => void;

function makeProfile(id: string, name: string): VehicleProfile {
  return {
    id,
    name,
    height_m: 2.5,
    width_m: 2.1,
    length_m: 6.5,
    weight_t: 3.5,
    avg_speed_kmh: 80,
    hazmat: false,
    avoid: { motorway: false, toll: false, ferry: false, unpaved: false },
    is_active: true,
  };
}

const FAVORITE: Favorite = {
  id: 'fav-1',
  name: 'Stellplatz Bodensee',
  latlng: { lat: 47.6, lon: 9.3 },
  icon: 'campsite',
  category: 'campsite',
  sort_order: 0,
};

describe('navigateToFavorite: active-profile invariant', () => {
  beforeEach(() => {
    requestRouteMock.mockClear();
    setDestinationMock.mockClear();
    setActiveProfile(null);
  });

  it('uses whatever profile is active AT TAP TIME -- profile A active', async () => {
    setActiveProfile(makeProfile('profile-a', 'Kastenwagen'));

    await navigateToFavorite(FAVORITE);

    expect(setDestinationMock).toHaveBeenCalledWith(FAVORITE.latlng, FAVORITE.name);
    expect(requestRouteMock).toHaveBeenCalledWith({ origin: 'current', profileId: 'profile-a' });
  });

  it('switches to whichever profile is now active -- the SAME favorite, a DIFFERENT (later-activated) profile', async () => {
    // Simulates: the favorite already existed while profile A was active
    // (nothing about the favorite itself references A -- it has no
    // profile_id field at all), the user then activates a different
    // profile B, and only THEN taps the favorite.
    setActiveProfile(makeProfile('profile-a', 'Kastenwagen'));
    // (favorite "existed" here, conceptually -- no route requested yet)
    setActiveProfile(makeProfile('profile-b', 'Alkoven 7.5t'));

    await navigateToFavorite(FAVORITE);

    expect(requestRouteMock).toHaveBeenCalledWith({ origin: 'current', profileId: 'profile-b' });
    expect(requestRouteMock).not.toHaveBeenCalledWith(
      expect.objectContaining({ profileId: 'profile-a' }),
    );
  });

  it('reflects a THIRD switch made between two consecutive taps of the same favorite', async () => {
    setActiveProfile(makeProfile('profile-a', 'A'));
    await navigateToFavorite(FAVORITE);
    expect(requestRouteMock).toHaveBeenLastCalledWith({ origin: 'current', profileId: 'profile-a' });

    setActiveProfile(makeProfile('profile-c', 'C'));
    await navigateToFavorite(FAVORITE);
    expect(requestRouteMock).toHaveBeenLastCalledWith({ origin: 'current', profileId: 'profile-c' });
  });

  it('passes profileId: undefined (not a stale id) when no profile is active at tap time', async () => {
    setActiveProfile(makeProfile('profile-a', 'A'));
    setActiveProfile(null);

    await navigateToFavorite(FAVORITE);

    expect(requestRouteMock).toHaveBeenCalledWith({ origin: 'current', profileId: undefined });
  });
});
