/**
 * Routing Initializer (E03-T3): mounts the routing feature at the app root,
 * mirroring `PositionInitializer`/`ProfilesPanel`.
 */

import React, { useEffect } from 'react';
import { useProfileStore } from '../profiles/store.js';
import RouteLayer from './RouteLayer.js';
import DestinationSelector from './DestinationSelector.js';
import RoutingPanel from './RoutingPanel.js';

export default function RoutingInitializer(): React.ReactElement {
  const profileCount = useProfileStore((state) => state.profiles.length);
  const fetchProfiles = useProfileStore((state) => state.fetchProfiles);

  // Routing needs `activeProfile.id` as soon as the user picks a
  // destination -- fetch profiles proactively on mount rather than waiting
  // for the user to have opened `ProfilesPanel` (which only fetches on its
  // own open/close lifecycle) at least once.
  useEffect(() => {
    if (profileCount === 0) {
      void fetchProfiles();
    }
    // Only ever needs to run once on mount.
  }, []);

  return (
    <>
      <RouteLayer />
      <DestinationSelector />
      <RoutingPanel />
    </>
  );
}
