/**
 * Position Initializer Component (E02-T2)
 *
 * Manages the lifecycle of browser geolocation and WebSocket position tracking.
 * This component should be mounted once at the app level to ensure:
 * - Browser geolocation source starts when the app loads
 * - Position WS connection is established
 * - Hints are shown for errors
 * - Puck is rendered on the map
 */

import React, { useEffect, useState } from 'react';
import { browserSource, type BrowserSourceState } from './browserSource';
import { positionWSManager } from './positionStore';
import PositionPuck from './PositionPuck';
import GeolocationHints from './GeolocationHints';

/**
 * PositionInitializer mounts at the app root and manages all position-related setup
 */
export default function PositionInitializer(): React.ReactElement {
  const [browserState, setBrowserState] = useState<BrowserSourceState>(browserSource.getState());

  // Initialize browser geolocation and WS connection on mount
  useEffect(() => {
    // Start browser geolocation tracking
    void browserSource.start();

    // Start WS connection to Core
    void positionWSManager.connect();

    // Listen to browser source state changes
    const unsubscribe = browserSource.onStateChange((state) => {
      setBrowserState(state);
    });

    return () => {
      unsubscribe?.();
      browserSource.stop();
      positionWSManager.disconnect();
    };
  }, []);

  return (
    <>
      {/* Render the position puck on the map */}
      <PositionPuck />

      {/* Show hints for errors */}
      <GeolocationHints sourceState={browserState} />
    </>
  );
}
