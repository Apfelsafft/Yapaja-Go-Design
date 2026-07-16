import { describe, it, expect, beforeEach } from 'vitest';
import { useTtsStore } from './ttsStore.js';

describe('ttsStore', () => {
  beforeEach(() => {
    useTtsStore.setState({ enabled: true });
  });

  it('defaults to enabled', () => {
    expect(useTtsStore.getState().enabled).toBe(true);
  });

  it('toggle() flips the flag', () => {
    useTtsStore.getState().toggle();
    expect(useTtsStore.getState().enabled).toBe(false);
    useTtsStore.getState().toggle();
    expect(useTtsStore.getState().enabled).toBe(true);
  });

  it('setEnabled() sets an explicit value', () => {
    useTtsStore.getState().setEnabled(false);
    expect(useTtsStore.getState().enabled).toBe(false);
  });
});
