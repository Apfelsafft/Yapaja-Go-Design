import { afterEach, describe, expect, it, vi } from 'vitest';
import { ansageNachRadioPause } from './radioPause.js';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('ansageNachRadioPause', () => {
  it('spricht erst, wenn der Kern das Radio angehalten hat', async () => {
    vi.stubGlobal('window', globalThis);
    let fertig: () => void = () => undefined;
    const fetch = vi.fn(() => new Promise<Response>((r) => (fertig = () => r(new Response('{}')))));
    vi.stubGlobal('fetch', fetch);
    const sprich = vi.fn();
    const p = ansageNachRadioPause('Jetzt links', sprich);
    expect(fetch.mock.calls[0]?.[0]).toMatch(/api\/v1\/ansage$/);
    await Promise.resolve();
    expect(sprich).not.toHaveBeenCalled();
    fertig();
    await p;
    expect(sprich).toHaveBeenCalledWith('Jetzt links');
  });

  it('wartet höchstens kurz und lässt eine überholte Ansage weg', async () => {
    vi.useFakeTimers();
    vi.stubGlobal('window', globalThis);
    vi.stubGlobal('fetch', vi.fn(() => new Promise(() => undefined)));
    const sprich = vi.fn();
    const alt = ansageNachRadioPause('alt', sprich);
    const neu = ansageNachRadioPause('neu', sprich);
    await vi.advanceTimersByTimeAsync(1_600);
    await Promise.all([alt, neu]);
    expect(sprich.mock.calls).toEqual([['neu']]);
  });
});
