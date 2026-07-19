/**
 * Onboarding step 4: vehicle profile creation (E08-T5) -- embeds the REAL
 * E06 `ProfileEditor`, not a reimplementation. A default "Camper" profile
 * already exists (seeded by `ProfileService#init` on first Core boot, see
 * `apps/core/src/profiles/service.ts`), so this step edits that active
 * profile in place rather than always creating a second one.
 */

import React, { useCallback, useEffect } from 'react';
import type { VehicleProfile } from '@yapaja/shared';
import { useProfileStore } from '../../profiles/store.js';
import ProfileEditor from '../../profiles/ProfileEditor.js';

const BLANK_PROFILE: Partial<VehicleProfile> = {
  name: '',
  height_m: 2.0,
  width_m: 2.0,
  length_m: 5.0,
  weight_t: 2.5,
  avg_speed_kmh: 80,
  hazmat: false,
  avoid: { motorway: false, toll: false, ferry: false, unpaved: false },
};

export interface VehicleProfileStepProps {
  /** Called after a successful save -- the wizard uses this to auto-advance. */
  onSaved?: () => void;
}

export default function VehicleProfileStep({ onSaved }: VehicleProfileStepProps): React.ReactElement {
  const activeProfile = useProfileStore((state) => state.activeProfile);
  const fetchProfiles = useProfileStore((state) => state.fetchProfiles);
  const createProfile = useProfileStore((state) => state.createProfile);
  const updateProfile = useProfileStore((state) => state.updateProfile);
  const activateProfile = useProfileStore((state) => state.activateProfile);

  useEffect(() => {
    void fetchProfiles();
  }, [fetchProfiles]);

  const handleSave = useCallback(
    async (profile: Partial<VehicleProfile>) => {
      if (activeProfile) {
        await updateProfile(activeProfile.id, profile);
      } else {
        const created = await createProfile(profile as Omit<VehicleProfile, 'id' | 'is_active'>);
        await activateProfile(created.id);
      }
      onSaved?.();
    },
    [activeProfile, updateProfile, createProfile, activateProfile, onSaved],
  );

  const handleCancel = useCallback(() => {
    // No-op: this step is skippable via the wizard's own "Überspringen"
    // button (task: "überspringbar ab Schritt 3") -- ProfileEditor still
    // requires an onCancel prop, so this just leaves the form as-is.
  }, []);

  return (
    <div data-testid="onboarding-step-profile">
      <ProfileEditor profile={activeProfile ?? BLANK_PROFILE} onSave={handleSave} onCancel={handleCancel} />
    </div>
  );
}
