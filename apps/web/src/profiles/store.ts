/**
 * Zustand store for vehicle profiles (E06-T2).
 * Manages the profile list and the currently active profile.
 */

import { create } from 'zustand';
import type { VehicleProfile } from '@yapaja/shared';
import * as client from './client.js';

export interface ProfileState {
  profiles: VehicleProfile[];
  activeProfile: VehicleProfile | null;
  isLoading: boolean;
  error: string | null;

  // Actions
  fetchProfiles: () => Promise<void>;
  setProfiles: (profiles: VehicleProfile[]) => void;
  setActiveProfile: (profile: VehicleProfile | null) => void;
  createProfile: (data: Omit<VehicleProfile, 'id' | 'is_active'>) => Promise<VehicleProfile>;
  updateProfile: (id: string, data: Partial<VehicleProfile>) => Promise<VehicleProfile>;
  deleteProfile: (id: string) => Promise<void>;
  activateProfile: (id: string) => Promise<VehicleProfile>;
  setError: (error: string | null) => void;
}

export const useProfileStore = create<ProfileState>((set) => ({
  profiles: [],
  activeProfile: null,
  isLoading: false,
  error: null,

  fetchProfiles: async () => {
    set({ isLoading: true, error: null });
    try {
      const profiles = await client.fetchProfiles();
      const active = profiles.find((p) => p.is_active) || null;
      set({ profiles, activeProfile: active, isLoading: false });
    } catch (err) {
      set({ error: (err as Error).message, isLoading: false });
    }
  },

  setProfiles: (profiles) => {
    const active = profiles.find((p) => p.is_active) || null;
    set({ profiles, activeProfile: active });
  },

  setActiveProfile: (profile) => {
    set({ activeProfile: profile });
  },

  createProfile: async (data) => {
    set({ error: null });
    try {
      const profile = await client.createProfile(data);
      set((state) => ({
        profiles: [...state.profiles, profile],
      }));
      return profile;
    } catch (err) {
      if (err instanceof client.ProfileApiError) {
        set({ error: err.message });
      }
      throw err;
    }
  },

  updateProfile: async (id, data) => {
    set({ error: null });
    try {
      const profile = await client.updateProfile(id, data);
      set((state) => ({
        profiles: state.profiles.map((p) => (p.id === id ? profile : p)),
      }));
      return profile;
    } catch (err) {
      if (err instanceof client.ProfileApiError) {
        set({ error: err.message });
      }
      throw err;
    }
  },

  deleteProfile: async (id) => {
    set({ error: null });
    try {
      await client.deleteProfile(id);
      set((state) => ({
        profiles: state.profiles.filter((p) => p.id !== id),
      }));
    } catch (err) {
      if (err instanceof client.ProfileApiError) {
        set({ error: err.message });
      }
      throw err;
    }
  },

  activateProfile: async (id) => {
    set({ error: null });
    try {
      const profile = await client.activateProfile(id);
      set((state) => ({
        profiles: state.profiles.map((p) => ({ ...p, is_active: p.id === id })),
        activeProfile: profile,
      }));
      return profile;
    } catch (err) {
      if (err instanceof client.ProfileApiError) {
        set({ error: err.message });
      }
      throw err;
    }
  },

  setError: (error) => {
    set({ error });
  },
}));
