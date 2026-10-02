import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { useFollowMeStore } from './followMe';
import { useZentrierenStore, zentrierenText } from './zentrieren';

// Die Testumgebung ist Node: ohne `window` setzt followMe gar keinen Wecker.
beforeEach(() => {
  vi.stubGlobal('window', globalThis);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
  useZentrierenStore.getState().setSekunden(10);
  useFollowMeStore.getState().resume();
});

describe('Zurück zur eigenen Position nach …', () => {
  it('folgt nach der eingestellten Zeit wieder', () => {
    vi.useFakeTimers();
    useZentrierenStore.getState().setSekunden(30);
    useFollowMeStore.getState().pause();
    vi.advanceTimersByTime(29_000);
    expect(useFollowMeStore.getState().isPaused).toBe(true);
    vi.advanceTimersByTime(1_500);
    expect(useFollowMeStore.getState().isPaused).toBe(false);
  });

  it('„aus" heißt: bleibt stehen, bis jemand zentriert', () => {
    vi.useFakeTimers();
    useZentrierenStore.getState().setSekunden(0);
    useFollowMeStore.getState().pause();
    vi.advanceTimersByTime(10 * 60_000);
    expect(useFollowMeStore.getState().isPaused).toBe(true);
    useFollowMeStore.getState().resume();
    expect(useFollowMeStore.getState().isPaused).toBe(false);
  });

  it('Beschriftung', () => {
    expect(zentrierenText(0)).toBe('aus');
    expect(zentrierenText(15)).toBe('15 s');
    expect(zentrierenText(120)).toBe('2 min');
  });
});
