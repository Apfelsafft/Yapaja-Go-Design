/**
 * Onboarding step 2: the mandatory, VERSIONED liability disclaimer consent
 * (E08-T5, docs/00 §"Rechtliches / Sicherheit"). This is the gate: the
 * wizard's "Weiter" button (in `OnboardingWizard.tsx`) stays disabled until
 * `hasValidConsent` is true, and `RoutingPanel.tsx`'s "Navigation starten"
 * reads the exact same `hasValidConsent` check independently -- see
 * `onboarding/store.ts#selectNavigationAllowed`.
 */

import React, { useState } from 'react';
import { hasValidConsent, type OnboardingState } from '../state.js';

export interface DisclaimerStepProps {
  state: OnboardingState;
  onAccept: () => void;
}

export default function DisclaimerStep({ state, onAccept }: DisclaimerStepProps): React.ReactElement {
  const [checked, setChecked] = useState(hasValidConsent(state));
  const accepted = hasValidConsent(state);

  return (
    <div className="space-y-4" data-testid="onboarding-step-disclaimer">
      <div className="rounded-md border border-amber-300 dark:border-amber-700 bg-amber-50 dark:bg-amber-900/20 p-3 text-sm text-amber-900 dark:text-amber-200 space-y-2">
        <p className="font-semibold">Haftungsausschluss</p>
        <p>
          Kartendaten können falsch oder veraltet sein. Beschilderung vor Ort hat immer Vorrang
          vor der Navigation.
        </p>
        <p>
          Die Kartendaten basieren auf OpenStreetMap (© OpenStreetMap contributors). Yapaja Go
          kann nicht garantieren, dass Höhen-, Gewichts- oder sonstige Einschränkungen vollständig
          erfasst sind.
        </p>
        <p>Es findet keine Telemetrie ohne deine Zustimmung statt; alle Daten bleiben lokal.</p>
      </div>

      <label className="flex items-start gap-2 text-sm cursor-pointer">
        <input
          type="checkbox"
          checked={checked}
          onChange={(e) => setChecked(e.target.checked)}
          className="mt-0.5"
          data-testid="onboarding-disclaimer-checkbox"
        />
        <span>
          Ich habe den Haftungsausschluss gelesen und verstanden. Mir ist bewusst, dass
          Kartendaten fehlerhaft sein können und ich die tatsächliche Beschilderung vor Ort immer
          beachten muss.
        </span>
      </label>

      {accepted ? (
        <p
          className="text-xs text-green-700 dark:text-green-400"
          data-testid="onboarding-disclaimer-accepted-status"
        >
          Zugestimmt am {new Date(state.disclaimer!.acceptedAt).toLocaleString('de-DE')} (Version{' '}
          {state.disclaimer!.version}).
        </p>
      ) : (
        <button
          type="button"
          onClick={onAccept}
          disabled={!checked}
          className="px-4 py-2 rounded-md bg-blue-600 text-white text-sm font-medium disabled:opacity-50 disabled:cursor-not-allowed"
          data-testid="onboarding-disclaimer-accept-button"
        >
          Zustimmen
        </button>
      )}
    </div>
  );
}
