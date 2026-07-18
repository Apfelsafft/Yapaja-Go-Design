/**
 * Profile chip for the top-bar (E06-T2).
 * Shows the active profile name with a 🚐 icon.
 * Clicking opens the profiles panel.
 */

import React from 'react';
import type { VehicleProfile } from '@yapaja/shared';

interface ProfileChipProps {
  activeProfile: VehicleProfile | null;
  onClick: () => void;
}

export default function ProfileChip({ activeProfile, onClick }: ProfileChipProps): React.ReactElement {
  return (
    <button
      onClick={onClick}
      type="button"
      aria-label={`Fahrzeugprofil wechseln (aktiv: ${activeProfile?.name ?? 'kein Profil'})`}
      className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-white/90 dark:bg-slate-800/90 border border-slate-200 dark:border-slate-700 shadow-sm hover:shadow-md transition-shadow text-sm text-slate-800 dark:text-slate-100 pointer-events-auto"
      title="Fahrzeugprofil wechseln"
      data-testid="profile-chip"
    >
      <span className="text-lg">🚐</span>
      <span data-testid="profile-chip-name">
        {activeProfile?.name ?? 'Profil'}
      </span>
    </button>
  );
}
