/**
 * Compass Button (E01-T3)
 *
 * FAB showing map bearing (needle rotates with map).
 * Appears only when map bearing ≠ 0 (threshold: |bearing| > 1°).
 * Click: returns to bearing 0 (north) with smooth animation and switches to 2d-north mode.
 */

import React, { useEffect, useState, useCallback } from 'react';
import { mapController } from '../state/mapStore';
import { useSetViewMode } from './viewMode';

export default function CompassButton(): React.ReactElement | null {
  const [bearing, setBearing] = useState(0);
  const [isVisible, setIsVisible] = useState(false);
  const setViewMode = useSetViewMode();

  // Update bearing from map
  useEffect(() => {
    const map = mapController.getMap();
    if (!map) {
      return;
    }

    const updateBearing = () => {
      const mapBearing = map.getBearing();
      setBearing(mapBearing);
      // Show if bearing is not close to 0 (threshold: > 1°)
      setIsVisible(Math.abs(mapBearing) > 1);
    };

    // Initial update
    updateBearing();

    // Listen to rotate events
    mapController.on('rotate', updateBearing);
    mapController.on('moveend', updateBearing);

    return () => {
      mapController.off('rotate', updateBearing);
      mapController.off('moveend', updateBearing);
    };
  }, []);

  const handleClick = useCallback(() => {
    // Return to north and switch to 2d-north mode
    mapController.setCamera({ bearing: 0 }, { animate: true, duration: 300 });
    setViewMode('2d-north');
  }, [setViewMode]);

  if (!isVisible) {
    return null;
  }

  return (
    <button
      onClick={handleClick}
      className="fixed bottom-[120px] right-4 w-12 h-12 rounded-full bg-white dark:bg-slate-800 shadow-lg hover:shadow-xl transition-shadow flex items-center justify-center focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 dark:focus:ring-offset-slate-900"
      aria-label="Zurück zu Nord"
      title="Zurück zu Nord"
      data-testid="compass-button"
    >
      {/* Compass needle pointing north, rotated by current bearing */}
      <svg
        className="w-6 h-6 text-slate-700 dark:text-slate-200"
        style={{ transform: `rotate(${-bearing}deg)` }}
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        {/* Arrow pointing up (north) */}
        <line x1="12" y1="5" x2="12" y2="19" />
        <polyline points="12 5 8 11 16 11" />
        {/* Circle background */}
      </svg>
    </button>
  );
}
