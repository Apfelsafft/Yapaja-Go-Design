import { describe, expect, it, vi } from 'vitest';
import { BrowserKanal } from './browserKanal.js';

function kanal(darf = true) {
  let zeit = 1_000;
  const sende = vi.fn();
  const k = new BrowserKanal({
    darf: async () => darf,
    pfad: async () => '/api/tts_proxy/a.mp3',
    sende,
    jetzt: () => zeit,
  });
  return { k, sende, weiter: (ms: number) => (zeit += ms) };
}

describe('BrowserKanal', () => {
  it('ohne angemeldeten Browser: sofort nein, nichts gesendet (kein Warten)', async () => {
    const { k, sende } = kanal();
    expect(await k.sage('Hallo', 'hinweis')).toBe(false);
    expect(sende).not.toHaveBeenCalled();
  });

  it('angemeldet: schickt die Sprache und wartet auf die Bestätigung', async () => {
    const { k, sende } = kanal();
    k.melde('Yapaia Browser');
    sende.mockImplementation((n: { id: string }) => queueBestaetigung(k, n.id));
    expect(await k.sage('Jetzt links', 'navigation')).toBe(true);
    expect(sende.mock.calls[0]![0]).toMatchObject({ pfad: '/api/tts_proxy/a.mp3' });
  });

  it('keine Bestätigung: nein (dann mischt Beat)', async () => {
    vi.useFakeTimers();
    const { k } = kanal();
    k.melde('Yapaia Browser');
    const p = k.sage('X', 'info');
    await vi.advanceTimersByTimeAsync(2_100);
    expect(await p).toBe(false);
    vi.useRealTimers();
  });

  it('Anmeldung läuft ab; darf=false: nein', async () => {
    const a = kanal();
    a.k.melde('B');
    a.weiter(16_000);
    expect(a.k.aktiv).toBe(false);
    const b = kanal(false);
    b.k.melde('B');
    expect(await b.k.sage('X', 'info')).toBe(false);
    expect(b.sende).not.toHaveBeenCalled();
  });
});

function queueBestaetigung(k: BrowserKanal, id: string): void {
  void Promise.resolve().then(() => k.bestaetige(id, true));
}
