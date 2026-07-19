/**
 * Onboarding wizard state (E08-T5): a pure, framework-free reducer over the
 * `settings.onboarding_state` shape (persisted server-side, see `client.ts`)
 * -- the same "keep the decision logic pure/testable, wire it up separately"
 * split already used by e.g. `theme/resolveTheme.ts` /
 * `shell/layout.ts#mergeLayouts`.
 *
 * Step order (docs/04, task E08-T5): language/units -> disclaimer -> region
 * -> vehicle profile -> GPS source -> MQTT. Skippable from `region` onward
 * (the task's explicit "überspringbar ab Schritt 3" -- language and the
 * disclaimer are NOT skippable: units/language always need *some* value and
 * the disclaimer is a mandatory, versioned consent gate, docs/00 §"Rechtliches
 * / Sicherheit").
 */

export const ONBOARDING_STEPS = [
  'language',
  'disclaimer',
  'region',
  'profile',
  'gps',
  'mqtt',
] as const;

export type OnboardingStep = (typeof ONBOARDING_STEPS)[number];

/**
 * Current disclaimer text version (docs/00 §"Rechtliches / Sicherheit").
 * Bumping this invalidates every previously-stored consent (`hasValidConsent`
 * below compares by exact version match) -- the mechanism a future wording
 * change would use to force re-consent.
 */
export const DISCLAIMER_VERSION = '1.0';

export interface DisclaimerConsent {
  /** The `DISCLAIMER_VERSION` that was accepted (not necessarily today's). */
  version: string;
  /** ISO-8601 UTC timestamp of acceptance. */
  acceptedAt: string;
}

export interface OnboardingState {
  step: OnboardingStep;
  /** True once the wizard has been walked through (or explicitly finished/skipped past its last step). */
  completed: boolean;
  disclaimer: DisclaimerConsent | null;
}

/** Fresh-instance default: first step, nothing consented yet. */
export function initialOnboardingState(): OnboardingState {
  return { step: ONBOARDING_STEPS[0], completed: false, disclaimer: null };
}

/** Defensively coerces an arbitrary (e.g. server JSON) value into a valid
 *  `OnboardingState`, falling back to `initialOnboardingState()` piece by
 *  piece for anything malformed -- a corrupted/older-shape settings value
 *  must never crash the wizard. */
export function coerceOnboardingState(value: unknown): OnboardingState {
  const fallback = initialOnboardingState();
  if (!value || typeof value !== 'object') return fallback;
  const raw = value as Record<string, unknown>;

  const step = (ONBOARDING_STEPS as readonly string[]).includes(raw.step as string)
    ? (raw.step as OnboardingStep)
    : fallback.step;
  const completed = typeof raw.completed === 'boolean' ? raw.completed : fallback.completed;

  let disclaimer: DisclaimerConsent | null = null;
  if (raw.disclaimer && typeof raw.disclaimer === 'object') {
    const d = raw.disclaimer as Record<string, unknown>;
    if (typeof d.version === 'string' && typeof d.acceptedAt === 'string') {
      disclaimer = { version: d.version, acceptedAt: d.acceptedAt };
    }
  }

  return { step, completed, disclaimer };
}

function stepIndex(step: OnboardingStep): number {
  return ONBOARDING_STEPS.indexOf(step);
}

/** The step after `step`, or `null` if `step` is already the last one. */
export function nextStep(step: OnboardingStep): OnboardingStep | null {
  const idx = stepIndex(step);
  return idx >= 0 && idx < ONBOARDING_STEPS.length - 1 ? ONBOARDING_STEPS[idx + 1] : null;
}

/** Skippable from the region step onward (task: "überspringbar ab Schritt 3"). */
export function isSkippable(step: OnboardingStep): boolean {
  return stepIndex(step) >= stepIndex('region');
}

/** Advances to the next step, or marks the wizard `completed` if `state.step`
 *  was already the last one. */
export function advance(state: OnboardingState): OnboardingState {
  const next = nextStep(state.step);
  if (next === null) {
    return { ...state, completed: true };
  }
  return { ...state, step: next };
}

/** Skips the current step, IF it is skippable -- a no-op (same state
 *  returned, by reference-equal shallow copy) otherwise, so callers can
 *  treat "skip" as always safe to invoke without checking `isSkippable`
 *  themselves first (though UI should still hide/disable the button). */
export function skip(state: OnboardingState): OnboardingState {
  if (!isSkippable(state.step)) return state;
  return advance(state);
}

/** Records disclaimer consent at the CURRENT `DISCLAIMER_VERSION`, with
 *  `acceptedAt` defaulting to "now" (injectable for tests). */
export function acceptDisclaimer(state: OnboardingState, acceptedAt: string = new Date().toISOString()): OnboardingState {
  return { ...state, disclaimer: { version: DISCLAIMER_VERSION, acceptedAt } };
}

/** True only when consent was recorded at the CURRENT disclaimer version --
 *  a stale (older-version) consent does NOT count, matching the task's
 *  "versioned consent" requirement. */
export function hasValidConsent(state: OnboardingState | null | undefined): boolean {
  return state?.disclaimer?.version === DISCLAIMER_VERSION;
}
