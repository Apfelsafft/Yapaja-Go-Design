/**
 * View Mode Button (E01-T3)
 *
 * FAB to cycle through view modes: 2d-north → 2d-course → 3d-course → 2d-north
 * Shows current mode icon. Touch-friendly (≥48px).
 * Positioned in map overlay (bottom-right area).
 */

import React, { useCallback } from 'react';
import { useViewMode, useSetViewMode, type ViewMode } from './viewMode';
import { rightStackBottomPx, EDGE_INSET_PX } from '../shell/mapControlLayout.js';
import { useNavStore } from '../drive/navStore.js';
import { isDriveActive } from '../drive/driveActive.js';

const MODE_ORDER: ViewMode[] = ['2d-north', '2d-course', '3d-course'];

function getModeLabel(mode: ViewMode): string {
  switch (mode) {
    case '2d-north':
      return '2D Nord';
    case '2d-course':
      return '2D Kurs';
    case '3d-course':
      return '3D Kurs';
  }
}

function getModeIcon(mode: ViewMode): string {
  switch (mode) {
    case '2d-north':
      return '🧭'; // Compass
    case '2d-course':
      return '⬆️'; // Arrow up (course)
    case '3d-course':
      return '🎥'; // 3D view
  }
}

export default function ViewModeButton(): React.ReactElement {
  const driveActive = isDriveActive(useNavStore((state) => state.navState?.status));
  const mode = useViewMode();
  const setViewMode = useSetViewMode();

  const handleClick = useCallback(() => {
    const currentIndex = MODE_ORDER.indexOf(mode);
    const nextIndex = (currentIndex + 1) % MODE_ORDER.length;
    setViewMode(MODE_ORDER[nextIndex]);
  }, [mode, setViewMode]);

  return (
    <button
      onClick={handleClick}
      style={{ bottom: rightStackBottomPx('viewmode', driveActive), right: EDGE_INSET_PX }}
      className="fixed w-12 h-12 rounded-full bg-white dark:bg-slate-800 shadow-lg hover:shadow-xl transition-shadow flex items-center justify-center focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 dark:focus:ring-offset-slate-900 text-lg font-semibold"
      aria-label={`Ansichtsmodus: ${getModeLabel(mode)}`}
      title={`Ansichtsmodus: ${getModeLabel(mode)}`}
      data-testid="viewmode-button"
    >
      {getModeIcon(mode)}
    </button>
  );
}
