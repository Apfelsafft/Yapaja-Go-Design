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
import { positionWSManager, usePositionStore } from './positionStore';
import type { Position } from '@yapaia/shared';

/**
 * Die letzte bekannte Position einmal beim Start holen.
 *
 * Gemeldet: „Wenn die Ansicht das erste Mal geladen wird, wird die ganze Karte
 * angezeigt." Über den WS kommt eine Position erst mit der NÄCHSTEN Meldung --
 * steht das Fahrzeug, meldet manche Quelle lange nichts Neues, und bis dahin
 * kennt die App keinen Punkt, auf den sie zoomen könnte. Der Kern weiß ihn
 * längst (`GET /api/v1/position`). Eine Meldung über den WS, die früher
 * ankommt, gewinnt.
 */
async function letztePositionHolen(): Promise<void> {
  try {
    const r = await fetch(`${import.meta.env.BASE_URL}api/v1/position`);
    if (r.status !== 200) return;
    const p = (await r.json()) as Position;
    if (typeof p?.lat !== 'number' || typeof p?.lon !== 'number') return;
    if (!usePositionStore.getState().position) usePositionStore.getState().setPosition(p);
  } catch {
    // Ohne Kern: dann eben mit der ersten Meldung.
  }
}
import PositionPuck from './PositionPuck';
import GeolocationHints from './GeolocationHints';
import GpsLossBanner from './GpsLossBanner';

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
    void letztePositionHolen();

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

      {/* GPS-loss banner (W-01): shown independently of browser-source errors */}
      <GpsLossBanner />
    </>
  );
}
