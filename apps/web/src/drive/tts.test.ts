/**
 * TTS availability/gong-fallback unit tests (E04-T3, Wargame W-23). The root
 * vitest config runs in `environment: 'node'` (no `window`/DOM, no
 * `speechSynthesis`, no `AudioContext`) -- exactly the "headless test
 * browser without the API" case these guards exist for, so these tests
 * double as that degrade-gracefully proof: nothing here may throw.
 */

import { describe, it, expect } from 'vitest';
import { isSpeechAvailable, isGongAvailable, speak, cancelSpeech, playGong, announce } from './tts.js';

describe('tts availability + graceful degradation (node/no-DOM environment)', () => {
  it('isSpeechAvailable() is false without window.speechSynthesis', () => {
    expect(isSpeechAvailable()).toBe(false);
  });

  it('isGongAvailable() is false without window.AudioContext', () => {
    expect(isGongAvailable()).toBe(false);
  });

  it('speak() never throws when the API is unavailable', () => {
    expect(() => speak('In 300 Metern links abbiegen')).not.toThrow();
  });

  it('cancelSpeech() never throws when the API is unavailable', () => {
    expect(() => cancelSpeech()).not.toThrow();
  });

  it('playGong() never throws when AudioContext is unavailable', () => {
    expect(() => playGong()).not.toThrow();
  });

  it('announce() falls back to the gong path without throwing when speech is unavailable', () => {
    expect(() => announce('Jetzt links abbiegen')).not.toThrow();
  });
});
