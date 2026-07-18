/**
 * Profiles panel/sheet (E06-T2).
 * Lists all profiles, allows activation, editing, and deletion.
 * Mounted top-left beside the brand badge (top-right + right edge are taken by
 * MapLibre controls, RegionsPanel and the FABs).
 */

import React, { useCallback, useEffect, useState } from 'react';
import type { VehicleProfile } from '@yapaja/shared';
import { useProfileStore, type ProfileState } from './store.js';
import ProfileChip from './ProfileChip.js';
import ProfileEditor from './ProfileEditor.js';
import { ProfileApiError } from './client.js';
import DriveLockGate from '../drive/DriveLockGate.js';

type EditorMode = 'create' | 'edit' | null;

export default function ProfilesPanel(): React.ReactElement {
  const [isOpen, setIsOpen] = useState(false);
  const [editorMode, setEditorMode] = useState<EditorMode>(null);
  const [editingProfile, setEditingProfile] = useState<Partial<VehicleProfile> | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const {
    profiles,
    activeProfile,
    fetchProfiles,
    activateProfile,
    createProfile,
    updateProfile,
    deleteProfile,
  } = useProfileStore((state: ProfileState) => ({
    profiles: state.profiles,
    activeProfile: state.activeProfile,
    fetchProfiles: state.fetchProfiles,
    activateProfile: state.activateProfile,
    createProfile: state.createProfile,
    updateProfile: state.updateProfile,
    deleteProfile: state.deleteProfile,
  }));

  // Load profiles on mount or when panel opens
  useEffect(() => {
    if (!isOpen) {
      return;
    }
    void fetchProfiles();
  }, [isOpen, fetchProfiles]);

  const handleToggleOpen = useCallback(() => setIsOpen((open) => !open), []);

  const handleCreateNew = useCallback(() => {
    setEditingProfile({
      name: '',
      height_m: 2.0,
      width_m: 2.0,
      length_m: 5.0,
      weight_t: 2.5,
      avg_speed_kmh: 80,
      hazmat: false,
      avoid: { motorway: false, toll: false, ferry: false, unpaved: false },
    });
    setEditorMode('create');
  }, []);

  const handleEditProfile = useCallback((profile: VehicleProfile) => {
    setEditingProfile(profile);
    setEditorMode('edit');
  }, []);

  const handleActivateProfile = useCallback(
    async (profileId: string) => {
      try {
        await activateProfile(profileId);
      } catch (err) {
        console.error('Failed to activate profile:', err);
      }
    },
    [activateProfile],
  );

  const handleDeleteProfile = useCallback(
    async (profileId: string) => {
      setDeleteError(null);
      try {
        await deleteProfile(profileId);
      } catch (err) {
        let message = 'Fehler beim Löschen des Profils.';
        if (err instanceof ProfileApiError) {
          if (err.code === 'ACTIVE_PROFILE_UNDELETABLE') {
            message =
              'Das aktive Profil kann nicht gelöscht werden. Aktiviere zuerst ein anderes Profil.';
          } else {
            message = err.message;
          }
        }
        setDeleteError(message);
      }
    },
    [deleteProfile],
  );

  const handleEditorSave = useCallback(
    async (profile: Partial<VehicleProfile>) => {
      setIsSaving(true);
      try {
        if (editorMode === 'create') {
          await createProfile(profile as Omit<VehicleProfile, 'id' | 'is_active'>);
        } else if (editorMode === 'edit' && editingProfile?.id) {
          await updateProfile(editingProfile.id, profile);
        }
        setEditorMode(null);
        setEditingProfile(null);
      } catch (err) {
        // Error is handled by the ProfileApiError in the store
        if (err instanceof Error) {
          console.error('Failed to save profile:', err.message);
        }
      } finally {
        setIsSaving(false);
      }
    },
    [editorMode, editingProfile, createProfile, updateProfile],
  );

  const handleEditorCancel = useCallback(() => {
    setEditorMode(null);
    setEditingProfile(null);
  }, []);

  return (
    // Top-LEFT, right of the "Yapaja Go" brand badge. The whole top-right +
    // right edge is taken (MapLibre's own zoom/compass NavigationControl at
    // top-right, RegionsPanel below it, the FABs bottom-right) -- placing the
    // chip at top-right made it overlap and swallow clicks meant for the
    // zoom-in button (gestures.spec). left-44 clears the brand badge.
    <div className="fixed top-4 left-44 z-10 pointer-events-none">
      {/* Chip in header (always visible) */}
      <div className="pointer-events-auto">
        <ProfileChip activeProfile={activeProfile} onClick={handleToggleOpen} />
      </div>

      {/* Panel (Sheet-style, appears when isOpen) */}
      {isOpen && !editorMode && (
        <div
          className="absolute top-12 left-0 mt-2 w-96 max-h-[70vh] overflow-y-auto rounded-xl bg-white/95 dark:bg-slate-800/95 shadow-xl p-4 text-sm text-slate-800 dark:text-slate-100 space-y-4 pointer-events-auto"
          data-testid="profiles-panel"
        >
          {/* Profiles list */}
          <section>
            <h2 className="font-semibold mb-3">Profile</h2>
            {profiles.length === 0 && (
              <p className="text-slate-500 dark:text-slate-400 text-xs">Keine Profile vorhanden.</p>
            )}
            <ul className="space-y-2">
              {profiles.map((profile) => (
                <li
                  key={profile.id}
                  className={`border rounded-lg p-3 cursor-pointer transition-colors ${
                    profile.is_active
                      ? 'border-blue-400 dark:border-blue-600 bg-blue-50 dark:bg-blue-900/30'
                      : 'border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-700/50'
                  }`}
                  data-testid={`profile-item-${profile.id}`}
                  onClick={() => {
                    if (!profile.is_active) {
                      void handleActivateProfile(profile.id);
                    }
                  }}
                >
                  <div className="flex items-start justify-between gap-2 mb-2">
                    <div className="flex-1">
                      <div className="font-medium text-slate-900 dark:text-white">{profile.name}</div>
                      <div className="text-xs text-slate-500 dark:text-slate-400 mt-1">
                        {profile.height_m.toFixed(2)} m H · {profile.width_m.toFixed(2)} m B ·{' '}
                        {profile.length_m.toFixed(2)} m L · {profile.weight_t.toFixed(1)} t
                      </div>
                    </div>
                    {profile.is_active && (
                      <span className="px-2 py-1 rounded-full bg-blue-500 text-white text-xs font-medium whitespace-nowrap">
                        Aktiv
                      </span>
                    )}
                  </div>
                  <div className="flex gap-1">
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        handleEditProfile(profile);
                      }}
                      className="flex-1 px-2 py-1 rounded-md border border-slate-300 dark:border-slate-600 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700 text-xs"
                      data-testid={`edit-button-${profile.id}`}
                    >
                      Bearbeiten
                    </button>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        void handleDeleteProfile(profile.id);
                      }}
                      className="flex-1 px-2 py-1 rounded-md border border-red-300 dark:border-red-700 text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/30 text-xs"
                      data-testid={`delete-button-${profile.id}`}
                    >
                      Löschen
                    </button>
                  </div>
                </li>
              ))}
            </ul>
            {deleteError && (
              <p className="mt-2 text-xs text-red-600 dark:text-red-400" data-testid="delete-error-message">
                {deleteError}
              </p>
            )}
          </section>

          {/* Create new button */}
          <button
            onClick={handleCreateNew}
            className="w-full px-4 py-2 rounded-md bg-blue-600 text-white hover:bg-blue-700 text-sm font-medium"
            data-testid="create-profile-button"
          >
            + Neues Profil
          </button>
        </div>
      )}

      {/* Editor modal */}
      {editorMode && editingProfile && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 pointer-events-auto">
          <div className="bg-white dark:bg-slate-800 rounded-xl shadow-2xl max-w-lg w-full max-h-[90vh] overflow-y-auto p-6 space-y-4">
            <h2 className="text-xl font-semibold text-slate-900 dark:text-white">
              {editorMode === 'create' ? 'Neues Profil' : 'Profil bearbeiten'}
            </h2>
            <div className="border-t border-slate-200 dark:border-slate-700 pt-4">
              {/* Speed-Lock (E07-T4): the Profile editor is one of docs/06
                  §4's "complex dialogs" gated above the configured
                  threshold. The list/activate view above stays reachable --
                  only the editor FORM itself is gated. */}
              <DriveLockGate controlId="profile-editor">
                <ProfileEditor
                  profile={editingProfile}
                  onSave={handleEditorSave}
                  onCancel={handleEditorCancel}
                  isSaving={isSaving}
                />
              </DriveLockGate>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
