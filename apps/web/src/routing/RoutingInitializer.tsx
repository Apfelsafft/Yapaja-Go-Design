/**
 * Routing Initializer (E03-T3): mounts the routing feature at the app root,
 * mirroring `PositionInitializer`/`ProfilesPanel`.
 */

import React, { useEffect } from 'react';
import { useProfileStore } from '../profiles/store.js';
import { useRoutingStore } from './store.js';
import RouteLayer from './RouteLayer.js';
import RouteRestorer from './RouteRestorer.js';
import DestinationSelector from './DestinationSelector.js';
import LangerDruckHinweis from './LangerDruckHinweis.js';
import RoutingPanel from './RoutingPanel.js';
import VerkehrLayer from '../online/VerkehrLayer.js';
import VerkehrHinweis from '../online/VerkehrHinweis.js';

export default function RoutingInitializer(): React.ReactElement {
  const profileCount = useProfileStore((state) => state.profiles.length);
  const fetchProfiles = useProfileStore((state) => state.fetchProfiles);
  const ladeRouteMode = useRoutingStore((state) => state.ladeRouteMode);

  // Routing needs `activeProfile.id` as soon as the user picks a
  // destination -- fetch profiles proactively on mount rather than waiting
  // for the user to have opened `ProfilesPanel` (which only fetches on its
  // own open/close lifecycle) at least once.
  useEffect(() => {
    if (profileCount === 0) {
      void fetchProfiles();
    }
    // Die gemerkte Routenart holen, damit die Anzeige nach einem Neuladen
    // das zeigt, was auch wirklich gilt.
    void ladeRouteMode();
    // Only ever needs to run once on mount.
  }, []);

  return (
    <>
      {/* Holt die Route nach einem Neuladen zurueck, damit die blaue Linie
          nicht fehlt, waehrend die Fahrt weiterlaeuft. */}
      <RouteRestorer />
      <RouteLayer />
      {/* Baustellen und Sperrungen auf der Strecke. Fragt NUR, wenn es eine
          Route gibt, und nur bei einer Änderung der Autobahnen — nicht bei
          jeder Positionsmeldung. Hier montiert und nicht in `MapView`, weil
          die Ebene die Route braucht und die hier liegt. */}
      <VerkehrLayer />
      {/* Sagt, was auf der Karte FEHLT — eine Autobahn ohne Antwort, ein
          alter Stand, Meldungen ohne Ort. Ohne ihn sähe eine unvollständige
          Karte aus wie eine leere Strecke. */}
      <VerkehrHinweis />
      <DestinationSelector />
      {/* Sagt, warum ein kurzer Tipper nichts tut. Ohne ihn sähe die neue
          Bedienung (Ziel nur noch per langem Druck) aus wie ein Defekt. */}
      <LangerDruckHinweis />
      <RoutingPanel />
    </>
  );
}
