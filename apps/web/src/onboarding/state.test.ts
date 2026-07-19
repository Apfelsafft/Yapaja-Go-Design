import { describe, it, expect } from 'vitest';
import {
  ONBOARDING_STEPS,
  DISCLAIMER_VERSION,
  initialOnboardingState,
  coerceOnboardingState,
  nextStep,
  isSkippable,
  advance,
  skip,
  acceptDisclaimer,
  hasValidConsent,
} from './state.js';

describe('initialOnboardingState', () => {
  it('starts at the first step, not completed, no consent', () => {
    const state = initialOnboardingState();
    expect(state.step).toBe('language');
    expect(state.completed).toBe(false);
    expect(state.disclaimer).toBeNull();
  });
});

describe('nextStep', () => {
  it('walks the full declared order', () => {
    expect(nextStep('language')).toBe('disclaimer');
    expect(nextStep('disclaimer')).toBe('region');
    expect(nextStep('region')).toBe('profile');
    expect(nextStep('profile')).toBe('gps');
    expect(nextStep('gps')).toBe('mqtt');
  });

  it('returns null after the last step', () => {
    expect(nextStep('mqtt')).toBeNull();
  });
});

describe('isSkippable (task: "überspringbar ab Schritt 3")', () => {
  it('language and disclaimer are NOT skippable', () => {
    expect(isSkippable('language')).toBe(false);
    expect(isSkippable('disclaimer')).toBe(false);
  });

  it('region onward IS skippable', () => {
    expect(isSkippable('region')).toBe(true);
    expect(isSkippable('profile')).toBe(true);
    expect(isSkippable('gps')).toBe(true);
    expect(isSkippable('mqtt')).toBe(true);
  });
});

describe('advance', () => {
  it('walks every step to completion in order', () => {
    let state = initialOnboardingState();
    for (let i = 1; i < ONBOARDING_STEPS.length; i++) {
      state = advance(state);
      expect(state.step).toBe(ONBOARDING_STEPS[i]);
      expect(state.completed).toBe(false);
    }
    // Advancing past the last step marks completed, step unchanged.
    state = advance(state);
    expect(state.step).toBe('mqtt');
    expect(state.completed).toBe(true);
  });
});

describe('skip', () => {
  it('is a no-op on non-skippable steps (language, disclaimer)', () => {
    const state = initialOnboardingState();
    expect(skip(state)).toEqual(state);

    const disclaimerStep = { ...state, step: 'disclaimer' as const };
    expect(skip(disclaimerStep)).toEqual(disclaimerStep);
  });

  it('advances on skippable steps (region onward)', () => {
    const regionStep = { ...initialOnboardingState(), step: 'region' as const };
    expect(skip(regionStep).step).toBe('profile');

    const mqttStep = { ...initialOnboardingState(), step: 'mqtt' as const };
    expect(skip(mqttStep).completed).toBe(true);
  });
});

describe('acceptDisclaimer / hasValidConsent (versioned consent)', () => {
  it('records the current version + the given/now timestamp', () => {
    const state = initialOnboardingState();
    const withConsent = acceptDisclaimer(state, '2026-07-19T10:00:00.000Z');
    expect(withConsent.disclaimer).toEqual({
      version: DISCLAIMER_VERSION,
      acceptedAt: '2026-07-19T10:00:00.000Z',
    });
    expect(hasValidConsent(withConsent)).toBe(true);
  });

  it('no consent -> false', () => {
    expect(hasValidConsent(initialOnboardingState())).toBe(false);
    expect(hasValidConsent(null)).toBe(false);
    expect(hasValidConsent(undefined)).toBe(false);
  });

  it('a STALE (older-version) consent does not count', () => {
    const stale = { ...initialOnboardingState(), disclaimer: { version: '0.9', acceptedAt: '2020-01-01T00:00:00.000Z' } };
    expect(hasValidConsent(stale)).toBe(false);
  });
});

describe('coerceOnboardingState (defensive parsing of server JSON)', () => {
  it('falls back to the initial state for garbage input', () => {
    expect(coerceOnboardingState(null)).toEqual(initialOnboardingState());
    expect(coerceOnboardingState(undefined)).toEqual(initialOnboardingState());
    expect(coerceOnboardingState('nonsense')).toEqual(initialOnboardingState());
    expect(coerceOnboardingState(42)).toEqual(initialOnboardingState());
  });

  it('falls back per-field for a partially-malformed object', () => {
    const result = coerceOnboardingState({ step: 'not-a-real-step', completed: 'yes', disclaimer: 'nope' });
    expect(result).toEqual(initialOnboardingState());
  });

  it('round-trips a well-formed value exactly', () => {
    const value = {
      step: 'gps',
      completed: false,
      disclaimer: { version: DISCLAIMER_VERSION, acceptedAt: '2026-07-19T10:00:00.000Z' },
    };
    expect(coerceOnboardingState(value)).toEqual(value);
  });

  it('accepts a value with disclaimer explicitly null', () => {
    const value = { step: 'mqtt', completed: true, disclaimer: null };
    expect(coerceOnboardingState(value)).toEqual(value);
  });
});
