/**
 * Onboarding wizard store (E08-T5): wires the pure `state.ts` reducer to the
 * server-side `settings.onboarding_state` persistence in `client.ts`, and is
 * the single source of truth `App.tsx`/`RoutingPanel.tsx` read from to decide
 * "show the wizard" / "is navigation allowed" (the disclaimer gate).
 */

import { create } from 'zustand';
import {
  initialOnboardingState,
  advance,
  skip,
  acceptDisclaimer,
  hasValidConsent,
  type OnboardingState,
  type OnboardingStep,
} from './state.js';
import { fetchOnboardingState, patchOnboardingState } from './client.js';

export interface OnboardingStoreState {
  /** `null` until the initial `load()` resolves. */
  state: OnboardingState | null;
  /** True once `load()` has resolved (successfully or not) at least once. */
  loaded: boolean;
  /** Explicitly reopened from Settings (docs task: "wieder aufrufbar aus
   *  Settings") -- shows the wizard even if `state.completed` is true,
   *  WITHOUT touching the persisted `completed` flag until the user actually
   *  finishes it again (so closing a reopened wizard early leaves the
   *  server's `completed:true` untouched). */
  forcedOpen: boolean;

  load: () => Promise<void>;
  advanceStep: () => Promise<void>;
  skipStep: () => Promise<void>;
  acceptDisclaimerConsent: () => Promise<void>;
  reopen: () => void;
  closeForced: () => void;
}

async function persist(state: OnboardingState): Promise<void> {
  await patchOnboardingState(state);
}

export const useOnboardingStore = create<OnboardingStoreState>((set, get) => ({
  state: null,
  loaded: false,
  forcedOpen: false,

  load: async () => {
    const server = await fetchOnboardingState();
    set({ state: server ?? initialOnboardingState(), loaded: true });
  },

  advanceStep: async () => {
    const current = get().state ?? initialOnboardingState();
    const next = advance(current);
    set({ state: next });
    await persist(next);
  },

  skipStep: async () => {
    const current = get().state ?? initialOnboardingState();
    const next = skip(current);
    set({ state: next });
    if (next !== current) {
      await persist(next);
    }
  },

  acceptDisclaimerConsent: async () => {
    const current = get().state ?? initialOnboardingState();
    const withConsent = acceptDisclaimer(current);
    set({ state: withConsent });
    await persist(withConsent);
  },

  reopen: () => set({ forcedOpen: true }),
  closeForced: () => set({ forcedOpen: false }),
}));

/** Whether the wizard should currently be shown: an explicit reopen from
 *  Settings, or a fresh/incomplete `onboarding_state`. `false` while still
 *  loading (`loaded === false`) -- avoids a one-frame flash of the wizard
 *  before we actually know the server's state. */
export function selectShouldShowWizard(store: OnboardingStoreState): boolean {
  if (!store.loaded) return false;
  if (store.forcedOpen) return true;
  return store.state !== null && !store.state.completed;
}

/** The disclaimer gate (acceptance criterion #3): navigation must not be
 *  startable without a CURRENT-version consent recorded. Used directly by
 *  `RoutingPanel.tsx`'s "Navigation starten" button. */
export function selectNavigationAllowed(store: OnboardingStoreState): boolean {
  // Before the initial load resolves, fail CLOSED (not allowed) -- matches
  // the gate's safety intent: never allow navigation on an unknown consent
  // state. Once loaded, defer entirely to `hasValidConsent`.
  if (!store.loaded) return false;
  return hasValidConsent(store.state);
}

export type { OnboardingState, OnboardingStep };
