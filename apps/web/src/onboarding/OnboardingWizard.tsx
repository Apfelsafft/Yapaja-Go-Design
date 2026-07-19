/**
 * First-run setup wizard shell (E08-T5): steps (1) language/units, (2)
 * liability disclaimer (mandatory, versioned consent -- the nav-start gate),
 * (3) region select+download (skippable from here on), (4) vehicle profile
 * (embeds the real E06 `ProfileEditor`), (5) GPS source select+test, (6)
 * MQTT (optional).
 *
 * ALWAYS mounted in `App.tsx` (so `useOnboardingStore`'s `load()` fires
 * immediately at app boot, resolving the disclaimer gate for
 * `RoutingPanel.tsx` as early as possible) -- it renders `null` once loaded
 * unless the wizard should actually be shown (`selectShouldShowWizard`:
 * fresh/incomplete `onboarding_state`, or explicitly reopened from
 * Settings).
 */

import React, { useEffect } from 'react';
import { useOnboardingStore, selectShouldShowWizard } from './store.js';
import { ONBOARDING_STEPS, isSkippable, hasValidConsent, type OnboardingStep } from './state.js';
import LanguageUnitsStep from './steps/LanguageUnitsStep.js';
import DisclaimerStep from './steps/DisclaimerStep.js';
import RegionStep from './steps/RegionStep.js';
import VehicleProfileStep from './steps/VehicleProfileStep.js';
import GpsStep from './steps/GpsStep.js';
import MqttStep from './steps/MqttStep.js';

const STEP_LABELS: Record<OnboardingStep, string> = {
  language: 'Sprache & Einheiten',
  disclaimer: 'Haftungsausschluss',
  region: 'Kartenregion',
  profile: 'Fahrzeugprofil',
  gps: 'GPS-Quelle',
  mqtt: 'MQTT (optional)',
};

export default function OnboardingWizard(): React.ReactElement | null {
  const load = useOnboardingStore((s) => s.load);
  const storeState = useOnboardingStore();
  const advanceStep = useOnboardingStore((s) => s.advanceStep);
  const skipStep = useOnboardingStore((s) => s.skipStep);
  const acceptDisclaimerConsent = useOnboardingStore((s) => s.acceptDisclaimerConsent);
  const closeForced = useOnboardingStore((s) => s.closeForced);

  useEffect(() => {
    void load();
  }, [load]);

  if (!selectShouldShowWizard(storeState) || !storeState.state) {
    return null;
  }

  const { step } = storeState.state;
  const stepIndex = ONBOARDING_STEPS.indexOf(step);
  const isLastStep = stepIndex === ONBOARDING_STEPS.length - 1;
  const nextDisabled = step === 'disclaimer' && !hasValidConsent(storeState.state);

  const handleNext = async (): Promise<void> => {
    await advanceStep();
    if (isLastStep) {
      closeForced();
      // `MapView` only checks for an installed region ONCE, at its own
      // mount time (a deliberate one-shot effect, not a live subscription --
      // see `map/MapView.tsx`'s Step 1 effect/`empty-regions.spec.ts`) -- if
      // the region step just installed the FIRST region of a fresh instance,
      // the already-mounted MapView would otherwise stay stuck on its
      // "Keine Karte installiert" empty state for the rest of this session.
      // A reload re-mounts everything fresh, immediately reflecting the
      // region/profile/GPS-source/MQTT setup just finished -- acceptance
      // criterion #1 ("führt bis zur fahrbereiten App").
      window.location.reload();
    }
  };

  const handleSkip = async (): Promise<void> => {
    await skipStep();
  };

  return (
    <div
      className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4"
      data-testid="onboarding-wizard"
    >
      <div className="bg-white dark:bg-slate-800 rounded-xl shadow-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto p-6 space-y-4">
        <div>
          <p className="text-xs text-slate-500 dark:text-slate-400 mb-1" data-testid="onboarding-step-indicator">
            Schritt {stepIndex + 1} von {ONBOARDING_STEPS.length}
          </p>
          <h2 className="text-xl font-semibold text-slate-900 dark:text-white">{STEP_LABELS[step]}</h2>
        </div>

        <div className="border-t border-slate-200 dark:border-slate-700 pt-4">
          {step === 'language' && <LanguageUnitsStep />}
          {step === 'disclaimer' && (
            <DisclaimerStep state={storeState.state} onAccept={() => void acceptDisclaimerConsent()} />
          )}
          {step === 'region' && <RegionStep />}
          {step === 'profile' && <VehicleProfileStep />}
          {step === 'gps' && <GpsStep />}
          {step === 'mqtt' && <MqttStep />}
        </div>

        <div className="flex justify-end gap-2 pt-2 border-t border-slate-200 dark:border-slate-700">
          {isSkippable(step) && !isLastStep && (
            <button
              type="button"
              onClick={() => void handleSkip()}
              className="px-4 py-2 rounded-md border border-slate-300 dark:border-slate-600 text-slate-700 dark:text-slate-300 text-sm"
              data-testid="onboarding-skip-button"
            >
              Überspringen
            </button>
          )}
          <button
            type="button"
            onClick={() => void handleNext()}
            disabled={nextDisabled}
            className="px-4 py-2 rounded-md bg-blue-600 text-white text-sm font-medium disabled:opacity-50 disabled:cursor-not-allowed"
            data-testid={isLastStep ? 'onboarding-finish-button' : 'onboarding-next-button'}
          >
            {isLastStep ? 'Fertig' : 'Weiter'}
          </button>
        </div>
      </div>
    </div>
  );
}
